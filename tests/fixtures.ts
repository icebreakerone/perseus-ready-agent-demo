import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// A throwaway signing CA hierarchy with IB1 extensions, generated per test
// run so no private keys live in the repository.
let dir: string | undefined

export function fixtures(): string {
  if (!dir) {
    dir = mkdtempSync(path.join(tmpdir(), 'perseus-fixtures-'))
    execFileSync(
      'uvx',
      ['--quiet', '--with', 'cryptography', '--with', 'asn1crypto', 'python', path.resolve(__dirname, '../scripts/gen-test-certs.py'), dir],
      { stdio: 'ignore' },
    )
  }
  return dir
}
