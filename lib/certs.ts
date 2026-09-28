import 'reflect-metadata'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as x509 from '@peculiar/x509'

x509.cryptoProvider.set(webcrypto as unknown as Crypto)

// IB1 member identity certificate extensions
// https://specification.trust.ib1.org/member-identity-digital-certificates/1.0/
export const OID_IB1_ROLES = '1.3.6.1.4.1.62329.1.1'
export const OID_IB1_MEMBER = '1.3.6.1.4.1.62329.1.3'

const UTF8_STRING = 0x0c
const SEQUENCE = 0x30

// Minimal DER reader: the IB1 extensions are a UTF8String or a SEQUENCE OF
// UTF8String, so tag/length/value is all we need.
function readTlv(bytes: Uint8Array, offset: number) {
  const tag = bytes[offset]
  let length = bytes[offset + 1]
  let header = 2
  if (length & 0x80) {
    const octets = length & 0x7f
    length = 0
    for (let i = 0; i < octets; i++) length = (length << 8) | bytes[offset + 2 + i]
    header += octets
  }
  const start = offset + header
  return { tag, value: bytes.subarray(start, start + length), next: start + length }
}

export function decodeUtf8String(der: Uint8Array): string {
  const { tag, value } = readTlv(der, 0)
  if (tag !== UTF8_STRING) throw new Error(`Expected UTF8String, got tag 0x${tag.toString(16)}`)
  return new TextDecoder().decode(value)
}

export function decodeUtf8Sequence(der: Uint8Array): string[] {
  const { tag, value } = readTlv(der, 0)
  if (tag !== SEQUENCE) throw new Error(`Expected SEQUENCE, got tag 0x${tag.toString(16)}`)
  const items: string[] = []
  for (let offset = 0; offset < value.length; ) {
    const item = readTlv(value, offset)
    if (item.tag !== UTF8_STRING) throw new Error('Expected SEQUENCE OF UTF8String')
    items.push(new TextDecoder().decode(item.value))
    offset = item.next
  }
  return items
}

export interface Ib1Identity {
  application: string
  member: string
  roles: string[]
  organisation: string
  serial: string
  notBefore: Date
  notAfter: Date
  subject: string
  issuer: string
}

export function parsePemChain(pem: string): x509.X509Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
  return blocks.map((block) => new x509.X509Certificate(block))
}

export function loadPem(path: string): x509.X509Certificate[] {
  return parsePemChain(readFileSync(path, 'utf8'))
}

// Provenance records identify certificates by decimal serial number.
export function decimalSerial(cert: x509.X509Certificate): string {
  return BigInt(`0x${cert.serialNumber}`).toString(10)
}

export function identity(cert: x509.X509Certificate): Ib1Identity {
  const san = cert.getExtension(x509.SubjectAlternativeNameExtension)
  const uris = san?.names.items.filter((n) => n.type === 'url').map((n) => n.value) ?? []
  if (uris.length !== 1)
    throw new Error("Certificate doesn't contain exactly one URI subject alternative name")
  const member = cert.getExtension(OID_IB1_MEMBER)
  const roles = cert.getExtension(OID_IB1_ROLES)
  if (!member) throw new Error('Certificate has no ib1Member extension')
  if (!roles) throw new Error('Certificate has no ib1Roles extension')
  return {
    application: uris[0],
    member: decodeUtf8String(new Uint8Array(member.value)),
    roles: decodeUtf8Sequence(new Uint8Array(roles.value)),
    organisation: cert.subjectName.getField('O')[0] ?? '',
    serial: decimalSerial(cert),
    notBefore: cert.notBefore,
    notAfter: cert.notAfter,
    subject: cert.subject,
    issuer: cert.issuer,
  }
}

// Verifies leaf → intermediates → trusted root, with every certificate valid
// at `at`. Provenance signatures are checked at their signing time.
export async function verifyChain(
  chain: x509.X509Certificate[],
  roots: x509.X509Certificate[],
  at: Date,
): Promise<void> {
  if (chain.length === 0) throw new Error('Empty certificate chain')
  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i]
    // The last certificate in the chain must be issued by a trusted root.
    const issuer = chain[i + 1] ?? roots.find((root) => root.subject === cert.issuer)
    if (!issuer) throw new Error(`No trusted issuer found for "${cert.subject}"`)
    const ok = await cert.verify({ publicKey: issuer.publicKey, date: at })
    if (!ok)
      throw new Error(
        `Certificate "${cert.subject}" is not valid or not signed by "${issuer.subject}" at ${at.toISOString()}`,
      )
  }
}
