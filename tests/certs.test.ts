import { describe, expect, it } from 'vitest'
import { identity, loadPem, verifyChain } from '@/lib/certs'
import { fixtures } from './fixtures'

const FIXTURES = fixtures()

describe('IB1 certificate extensions', () => {
  it('reads application, member and roles', () => {
    const [leaf] = loadPem(`${FIXTURES}/cap-bundle.pem`)
    const id = identity(leaf)
    expect(id.application).toBe('https://directory.core.sandbox.trust.ib1.org/a/ciro1gll')
    expect(id.member).toBe('https://directory.core.sandbox.trust.ib1.org/m/4tnapijm')
    expect(id.roles).toEqual(['https://registry.core.sandbox.trust.ib1.org/scheme/perseus/role/carbon-accounting-provider'])
    expect(id.serial).toMatch(/^\d+$/)
  })

  it('verifies the chain to the root, and rejects an untrusted root', async () => {
    const chain = loadPem(`${FIXTURES}/cap-bundle.pem`)
    const [root] = loadPem(`${FIXTURES}/root-ca.pem`)
    await expect(verifyChain(chain, [root], new Date())).resolves.toBeUndefined()
    await expect(verifyChain(chain.slice(0, 1), [chain[0]], new Date())).rejects.toThrow()
    await expect(verifyChain(chain, [root], new Date('2000-01-01'))).rejects.toThrow()
  })
})
