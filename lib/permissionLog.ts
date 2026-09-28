import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from './config'
import type { PermissionGrant } from './session'

// The CAP guide requires logging, at minimum: timestamp, logged-in user, IP
// address, user agent and the Registry URL of the Data Licence.
export function logPermission(grant: PermissionGrant) {
  mkdirSync(config.dataDir, { recursive: true })
  const { permissionText: _text, ...entry } = grant
  appendFileSync(path.join(config.dataDir, 'permission-log.jsonl'), `${JSON.stringify(entry)}\n`)
}
