import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CertificateProvider, ProvenanceRecord, Signer, type EncodedRecord } from '@/lib/provenance'
import { fixtures } from './fixtures'

const TF = 'https://registry.core.sandbox.trust.ib1.org/trust-framework'
const FIXTURES = fixtures()
const SCRIPT = path.resolve(__dirname, '../scripts/provenance-crosscheck.py')

function python(...args: string[]): string {
  return execFileSync('uvx', ['--quiet', '--with', 'ib1-provenance', 'python', SCRIPT, ...args], {
    encoding: 'utf8',
  })
}

const provider = CertificateProvider.fromRootPem(readFileSync(`${FIXTURES}/root-ca.pem`, 'utf8'))
const capSigner = Signer.fromFiles(
  provider,
  readFileSync(`${FIXTURES}/cap-bundle.pem`, 'utf8'),
  `${FIXTURES}/cap-key.pem`,
)

describe('provenance records interoperate with ib1-provenance', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prov-'))
  const edpPath = path.join(dir, 'edp.json')
  python('edp-record', FIXTURES, edpPath)
  const edpEncoded = JSON.parse(readFileSync(edpPath, 'utf8')) as EncodedRecord

  it('verifies a record signed by the reference library', async () => {
    const record = new ProvenanceRecord(TF, edpEncoded)
    await record.verify(provider)
    const transfer = record.findStep({
      type: 'transfer',
      to: 'https://directory.core.sandbox.trust.ib1.org/a/ciro1gll',
      _signature: { signed: { member: 'https://directory.core.sandbox.trust.ib1.org/m/7a1qv915' } },
    })
    expect(transfer.path).toBe('/readings')
    expect(record.decoded().find((s) => s.type === 'origin')?.note).toBe('café non-ASCII check')
  })

  it('produces nested signed records the reference library verifies', async () => {
    const received = new ProvenanceRecord(TF, edpEncoded)
    await received.verify(provider)
    const transfer = received.findStep({ type: 'transfer' })
    received.addStep({ type: 'receipt', transfer: transfer.id })
    const layer1 = received.sign(capSigner)

    const next = new ProvenanceRecord(TF, layer1.encoded())
    next.addStep({ type: 'origin', external: true, sourceType: 'x', note: 'naïve' })
    const layer2 = next.sign(capSigner)

    const out = path.join(dir, 'cap.json')
    writeFileSync(out, JSON.stringify(layer2.encoded()))
    const decoded = JSON.parse(python('verify', `${FIXTURES}/root-ca.pem`, out)) as {
      type: string
      _signature: { signed: { application: string } }
    }[]
    expect(decoded.map((s) => s.type)).toEqual(['permission', 'origin', 'transfer', 'receipt', 'origin'])
    expect(decoded.at(-1)!._signature.signed.application).toBe(
      'https://directory.core.sandbox.trust.ib1.org/a/ciro1gll',
    )
  })

  it('rejects a tampered record', async () => {
    const tampered = structuredClone(edpEncoded)
    const steps = tampered.steps as unknown[]
    steps[0] = Buffer.from('{"id":"x","type":"origin"}').toString('base64')
    await expect(new ProvenanceRecord(TF, tampered).verify(provider)).rejects.toThrow()
  })
})
