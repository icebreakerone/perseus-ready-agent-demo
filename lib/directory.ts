import { createHash } from 'node:crypto'
import { config } from './config'
import type { Recorder } from './http'

export interface Membership {
  trustFramework: string
  trustFrameworkName: string
  membershipStatus: string
  membershipExpiry: string
}

export interface SchemeMembership {
  scheme: string
  schemeName: string
  orgRoles: string[]
  executions: { executed: string; expiry: string; agreement: { name: string; agreementUrl: string } }[]
}

export interface Member {
  id: string
  legalName: string
  email?: string
  brand?: { name?: string }
  roles: string[]
  privacyPolicy?: string
  identifier?: string
  trustFrameworkMemberships?: Membership[]
  schemeMemberships?: SchemeMembership[]
}

export interface Application {
  id: string
  publisher: string
  title: string
  description: string
  scheme: string
  role: string[]
  homePageURL: string
  messageDelivery: string
}

export interface DataService {
  id: string
  application_id: string
  publisher: string
  title: string
  conformsTo: string
  endpointURL: string
  oauthIssuer: string
}

// The CAP guide: use brand.name if present, otherwise legalName.
export const displayName = (m: Member) => m.brand?.name || m.legalName

export function memberIdentifier(url: string): string {
  const match = url.match(/\/m\/([A-Za-z0-9]+)\/?$/)
  if (!match) throw new Error(`Not a Directory member URL: ${url}`)
  return match[1]
}

export async function getMember(rec: Recorder, identifier: string, label = 'Directory member'): Promise<Member> {
  return rec.json<Member>(label, `${config.directoryUrl}/m/${identifier}?include=memberships`)
}

export async function getApplication(rec: Recorder, identifier: string): Promise<Application> {
  return rec.json<Application>('Directory application', `${config.directoryUrl}/a/${identifier}`)
}

export async function queryDataServices(rec: Recorder, conformsTo: string): Promise<DataService[]> {
  const url = `${config.directoryUrl}/query/data-services?conformsTo=${encodeURIComponent(conformsTo)}`
  const body = await rec.json<{ apis: DataService[] }>('Directory data service catalogue', url)
  return body.apis
}

// Registry resources are fetched as JSON-LD; the permission text is a separate
// document whose URL fragment is the SHA-256 of its content.
export async function getPermissionText(rec: Recorder, licenseUrl: string) {
  const license = await rec.json<{ 'ib1:permissionText': { '@id': string } }>(
    'Registry licence',
    licenseUrl,
    { headers: { Accept: 'application/ld+json' } },
  )
  const textUrl = license['ib1:permissionText']['@id']
  const [documentUrl, expectedHash] = textUrl.split('#')
  const response = await rec.request('Registry permission text', documentUrl)
  if (response.status !== 200) throw new Error(`Permission text: HTTP ${response.status}`)
  const hash = createHash('sha256').update(response.text, 'utf8').digest('hex')
  if (expectedHash && hash !== expectedHash)
    throw new Error(`Permission text hash ${hash} does not match the licence's ${expectedHash}`)
  return { text: response.text, url: textUrl }
}

export function isMembershipActive(expiry: string, now = new Date()) {
  return new Date(expiry).getTime() > now.getTime()
}
