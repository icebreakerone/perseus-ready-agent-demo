// Provenance Records 1.0, ported from the reference ib1-provenance library
// (Python, v0.5.3) so records round-trip with other members' implementations.
// https://specification.trust.ib1.org/provenance-records/1.0/
import { createPrivateKey, createPublicKey, randomBytes, sign as cryptoSign, verify as cryptoVerify, KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type * as x509 from '@peculiar/x509'
import { decimalSerial, identity, parsePemChain, verifyChain } from './certs'

const CONTAINER_FORMAT_VERSION = 0

// A signed container: steps (base64 JSON) and nested containers, closed by a
// signature block [version, serial, timestamp, signature].
type SignatureBlock = [number, string, string, string]
type Container = (string | Container | SignatureBlock)[]

export interface EncodedRecord {
  'ib1:provenance': string
  origins: string[]
  steps: Container
  certificates?: Record<string, string[]>
}

export interface SignerInfo {
  member: string
  name: string
  application: string
  roles: string[]
}

export type Step = Record<string, unknown> & {
  id: string
  type: string
  timestamp: string
  _signature?: { signed: SignerInfo; includedBy: SignerInfo[] }
}

// Python's urlsafe_b64encode keeps '=' padding; Node's base64url drops it.
function b64urlEncode(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64urlDecode(text: string): Buffer {
  return Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

// Matches Python's json.dumps(separators=(",", ":")), which escapes non-ASCII.
function pyJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u0080-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

function timestampNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function decodeStep(encoded: string): Step {
  return JSON.parse(b64urlDecode(encoded).toString('utf8')) as Step
}

function isSignatureBlock(e: unknown): e is SignatureBlock {
  return Array.isArray(e) && typeof e[0] === 'number'
}

function dataForSigning(trustFramework: string, data: Container, additional?: string[], isRoot = true): string {
  const gather: string[] = []
  if (isRoot) gather.push(trustFramework)
  for (const e of data) {
    if (typeof e === 'string') gather.push(e)
    else if (typeof e === 'number') gather.push(String(e))
    else {
      gather.push('%')
      gather.push(dataForSigning(trustFramework, e as Container, undefined, false))
      gather.push('&')
    }
  }
  if (additional) gather.push(...additional)
  return gather.join('.')
}

export class CertificateProvider {
  constructor(
    private readonly roots: x509.X509Certificate[],
    // Include our certificates in records we sign, so recipients can verify
    // without fetching anything.
    readonly includeCertificatesInRecord = true,
  ) {}

  static fromRootPem(pem: string) {
    return new CertificateProvider(parsePemChain(pem))
  }

  certificatesForSerial(fromRecord: Record<string, string[]>, serial: string): x509.X509Certificate[] {
    const entry = fromRecord[serial]
    if (!entry) throw new Error(`Certificate serial ${serial} is not present in record`)
    const [leafPem, ...pathSerials] = entry
    const pems = [leafPem, ...pathSerials.map((s) => {
      const issuer = fromRecord[s]
      if (!issuer) throw new Error(`Issuer certificate serial ${s} is not present in record`)
      return issuer[0]
    })]
    return pems.flatMap((pem) => parsePemChain(pem))
  }

  async verify(
    fromRecord: Record<string, string[]>,
    serial: string,
    signTimestamp: string,
    data: string,
    signature: Buffer,
  ): Promise<SignerInfo> {
    const [signingCert, ...issuers] = this.certificatesForSerial(fromRecord, serial)
    if (decimalSerial(signingCert) !== serial)
      throw new Error(`Certificate for serial ${serial} has a different serial number`)
    await verifyChain([signingCert, ...issuers], this.roots, new Date(signTimestamp))
    const key = createPublicKey({ key: Buffer.from(signingCert.publicKey.rawData), format: 'der', type: 'spki' })
    const ok = cryptoVerify('sha256', Buffer.from(data, 'utf8'), { key, dsaEncoding: 'der' }, signature)
    if (!ok) throw new Error(`Bad signature by certificate serial ${serial}`)
    const id = identity(signingCert)
    return { member: id.member, name: id.organisation, application: id.application, roles: id.roles }
  }
}

export class Signer {
  constructor(
    private readonly provider: CertificateProvider,
    // Signing certificate first, then its issuer chain.
    private readonly certificates: x509.X509Certificate[],
    private readonly privateKey: KeyObject,
  ) {}

  static fromFiles(provider: CertificateProvider, bundlePem: string, keyPath: string) {
    return new Signer(provider, parsePemChain(bundlePem), createPrivateKey(readFileSync(keyPath)))
  }

  serial(): string {
    return decimalSerial(this.certificates[0])
  }

  certificatesForRecord(): x509.X509Certificate[] | undefined {
    return this.provider.includeCertificatesInRecord ? [...this.certificates] : undefined
  }

  sign(data: string): Buffer {
    return cryptoSign('sha256', Buffer.from(data, 'utf8'), { key: this.privateKey, dsaEncoding: 'der' })
  }
}

export class ProvenanceRecord {
  private additionalRecords: EncodedRecord[] = []
  private additionalSteps: Step[] = []
  private signed = true
  private verified?: Step[]

  constructor(
    readonly trustFramework: string,
    private readonly record?: EncodedRecord,
  ) {
    if (record) {
      if (!Array.isArray(record.steps)) throw new Error('Not an encoded Provenance record')
      if (record['ib1:provenance'] !== trustFramework)
        throw new Error('Unexpected trust framework when creating Record from encoded form')
    }
  }

  async verify(provider: CertificateProvider): Promise<void> {
    this.requireSigned()
    if (!this.record) throw new Error('Nothing to verify')
    const steps: Step[] = []
    const origins: string[] = []
    await this.verifyContainer(this.record.steps, this.record.certificates ?? {}, provider, steps, origins, [])
    if (JSON.stringify(this.record.origins) !== JSON.stringify(origins))
      throw new Error('origins property does not match origin steps in record')
    this.verified = steps
  }

  private async verifyContainer(
    container: Container,
    certificates: Record<string, string[]>,
    provider: CertificateProvider,
    steps: Step[],
    origins: string[],
    signerStack: SignerInfo[],
  ) {
    const data = container.slice(0, -1) as Container
    const block = container[container.length - 1]
    if (!isSignatureBlock(block)) throw new Error('Container has no signature block')
    const [version, serial, signTimestamp, signature] = block
    if (version !== CONTAINER_FORMAT_VERSION)
      throw new Error(`Cannot decode container format version: ${version}`)
    if (!/^(0|[1-9]\d*)$/.test(serial)) throw new Error(`Bad certificate serial number in record: ${serial}`)
    const signingInput = dataForSigning(this.trustFramework, data, [String(version), serial, signTimestamp])
    const signer = await provider.verify(certificates, serial, signTimestamp, signingInput, b64urlDecode(signature))
    for (const e of data) {
      if (typeof e !== 'string') {
        await this.verifyContainer(e as Container, certificates, provider, steps, origins, [...signerStack, signer])
      } else {
        const step = decodeStep(e)
        if (step.type === 'origin') origins.push(step.id)
        step._signature = { signed: signer, includedBy: [...signerStack] }
        steps.push(step)
      }
    }
  }

  addRecord(other: ProvenanceRecord) {
    if (other.trustFramework !== this.trustFramework)
      throw new Error('Incompatible trust frameworks in added Record')
    this.signed = false
    this.verified = undefined
    this.additionalRecords.push(other.encoded())
  }

  addStep(stepIn: Record<string, unknown>): string {
    if ('id' in stepIn)
      throw new Error('Step may not contain an id key. Identifiers are allocated automatically.')
    const { timestamp, type, ...rest } = structuredClone(stepIn)
    const prohibited = Object.keys(rest).filter((k) => k.startsWith('_'))
    if (prohibited.length)
      throw new Error(`Step may not contain keys beginning with an underscore: ${prohibited.join(', ')}`)
    this.signed = false
    this.verified = undefined
    // Same shape as secrets.token_urlsafe(15)
    const id = randomBytes(15).toString('base64url')
    this.additionalSteps.push({
      id,
      timestamp: (timestamp as string | undefined) || timestampNow(),
      type: type as string,
      ...rest,
    })
    return id
  }

  findStep(required: Record<string, unknown>): Step {
    const matches = this.filterSteps(required)
    if (matches.length === 0) throw new Error('No step matches required values')
    if (matches.length > 1) throw new Error('More than one step matches required values')
    return matches[0]
  }

  filterSteps(required: Record<string, unknown>): Step[] {
    this.requireVerified()
    return this.verified!.filter((step) => contains(step, required))
  }

  sign(signer: Signer): ProvenanceRecord {
    const output: Container = []
    const certificates: Record<string, string[]> = {}
    if (this.record) {
      Object.assign(certificates, this.record.certificates ?? {})
      output.push(this.record.steps)
    }
    for (const r of this.additionalRecords) {
      Object.assign(certificates, r.certificates ?? {})
      output.push(r.steps)
    }
    for (const s of this.additionalSteps) output.push(b64urlEncode(Buffer.from(pyJson(s), 'utf8')))

    const serial = signer.serial()
    const signTimestamp = timestampNow()
    const signingInput = dataForSigning(this.trustFramework, output, [String(CONTAINER_FORMAT_VERSION), serial, signTimestamp])
    output.push([CONTAINER_FORMAT_VERSION, serial, signTimestamp, b64urlEncode(signer.sign(signingInput))])

    if (!(serial in certificates)) {
      const certs = signer.certificatesForRecord()
      if (certs) {
        const [first, ...others] = certs
        certificates[serial] = [first.toString('pem'), ...others.map(decimalSerial)]
        for (const c of others) certificates[decimalSerial(c)] = [c.toString('pem')]
      }
    }

    const encoded: EncodedRecord = {
      'ib1:provenance': this.trustFramework,
      origins: gatherOrigins(output),
      steps: structuredClone(output),
    }
    if (Object.keys(certificates).length) encoded.certificates = certificates
    return new ProvenanceRecord(this.trustFramework, encoded)
  }

  encoded(): EncodedRecord {
    this.requireSigned()
    if (!this.record) throw new Error('Record is empty')
    return this.record
  }

  decoded(): Step[] {
    this.requireVerified()
    return structuredClone(this.verified!)
  }

  private requireSigned() {
    if (!this.signed) throw new Error('Record is not signed, call sign() and use returned object')
  }

  private requireVerified() {
    if (!(this.signed && this.verified)) throw new Error('Record is not verified, call verify() first')
  }
}

function gatherOrigins(container: Container, origins: string[] = []): string[] {
  for (const e of container.slice(0, -1)) {
    if (typeof e !== 'string') gatherOrigins(e as Container, origins)
    else {
      const step = decodeStep(e)
      if (step.type === 'origin') origins.push(step.id)
    }
  }
  return origins
}

// Same semantics as the reference filter: dicts match on a subset of keys,
// lists match when every required element matches some element.
function contains(actual: unknown, required: unknown): boolean {
  if (Array.isArray(required)) {
    return Array.isArray(actual) && required.every((r) => actual.some((a) => contains(a, r)))
  }
  if (required !== null && typeof required === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
    return Object.entries(required).every(
      ([k, v]) => k in (actual as object) && contains((actual as Record<string, unknown>)[k], v),
    )
  }
  return actual === required
}
