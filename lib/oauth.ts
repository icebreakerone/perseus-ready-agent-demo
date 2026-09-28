// IB1 OAuth profile: FAPI 2.0 with PAR, PKCE S256 and tls_client_auth. The
// client_id is our application's Directory URL and there is no client secret.
// https://specification.docs.ib1.org/oauth-with-member-identity-certificates/1.0/
import { createHash, randomBytes } from 'node:crypto'
import { config } from './config'
import type { Recorder } from './http'

export interface AuthServerMetadata {
  issuer: string
  authorization_endpoint: string
  pushed_authorization_request_endpoint: string
  token_endpoint: string
  revocation_endpoint?: string
  ib1_permission_endpoint?: string
  require_pushed_authorization_requests?: boolean
  code_challenge_methods_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  tls_client_certificate_bound_access_tokens?: boolean
  authorization_response_iss_parameter_supported?: boolean
  mtls_endpoint_aliases?: Partial<Record<
    'pushed_authorization_request_endpoint' | 'token_endpoint' | 'revocation_endpoint' | 'ib1_permission_endpoint',
    string
  >>
}

// RFC 8414 §3: the well-known segment goes between the host and any issuer path.
export function metadataUrl(issuer: string): string {
  const url = new URL(issuer)
  const issuerPath = url.pathname.replace(/\/$/, '')
  return `${url.origin}/.well-known/oauth-authorization-server${issuerPath}`
}

export async function discover(rec: Recorder, issuer: string): Promise<AuthServerMetadata> {
  const metadata = await rec.json<AuthServerMetadata>('Authorisation server metadata', metadataUrl(issuer))
  // RFC 8414 §3.3: the issuer in the metadata must be the one we looked up.
  if (metadata.issuer.replace(/\/$/, '') !== issuer.replace(/\/$/, ''))
    throw new Error(`Metadata issuer ${metadata.issuer} does not match ${issuer}`)
  return metadata
}

// Server-to-server calls use the mTLS aliases (RFC 8705 §5).
export function mtlsEndpoint(
  metadata: AuthServerMetadata,
  name: keyof NonNullable<AuthServerMetadata['mtls_endpoint_aliases']>,
): string | undefined {
  return metadata.mtls_endpoint_aliases?.[name] ?? metadata[name]
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export async function pushAuthorisationRequest(
  rec: Recorder,
  parEndpoint: string,
  params: { state: string; codeChallenge: string },
): Promise<{ request_uri: string; expires_in: number }> {
  const body = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    // Per the profile, the scope is the Registry licence URL and nothing else.
    scope: config.license,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    state: params.state,
  })
  const response = await rec.request('Pushed authorisation request (PAR)', parEndpoint, {
    method: 'POST',
    mtls: true,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (response.status !== 201 && response.status !== 200)
    throw new Error(`PAR rejected: HTTP ${response.status} ${response.text.slice(0, 300)}`)
  const result = response.json<{ request_uri: string; expires_in: number }>()
  if (!result.request_uri) throw new Error('PAR response has no request_uri')
  return result
}

export function authorisationUrl(authorizationEndpoint: string, requestUri: string): string {
  const url = new URL(authorizationEndpoint)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('request_uri', requestUri)
  return url.toString()
}

export interface TokenResponse {
  access_token: string
  token_type?: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

export async function exchangeCode(
  rec: Recorder,
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
  })
  const response = await rec.request('Token exchange', tokenEndpoint, {
    method: 'POST',
    mtls: true,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (response.status !== 200)
    throw new Error(`Token exchange failed: HTTP ${response.status} ${response.text.slice(0, 300)}`)
  const tokens = response.json<TokenResponse>()
  if (!tokens.access_token) throw new Error('Token response has no access_token')
  return tokens
}

export interface PermissionRecord {
  oauthIssuer?: string
  client?: string
  license?: string
  account?: string
  lastGranted?: string
  expires?: string
  evidence?: string
  revoked?: string | null
  dataAvailableFrom?: string
  tokenIssuedAt?: string
  tokenExpires?: string
}

// Only the refresh token is accepted here; access tokens must be refused.
export async function fetchPermissionRecord(
  rec: Recorder,
  permissionEndpoint: string,
  refreshToken: string,
): Promise<{ record: PermissionRecord; wrapper: 'permission' | 'permissions' }> {
  const response = await rec.request('Permission record', permissionEndpoint, {
    method: 'POST',
    mtls: true,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  })
  if (response.status !== 200)
    throw new Error(`Permission record request failed: HTTP ${response.status} ${response.text.slice(0, 300)}`)
  const body = response.json<{ permission?: PermissionRecord | PermissionRecord[]; permissions?: PermissionRecord | PermissionRecord[] }>()
  const wrapper = body.permission ? 'permission' : 'permissions'
  const value = body.permission ?? body.permissions
  const record = Array.isArray(value) ? value[0] : value
  if (!record) throw new Error('Permission record response has no permission')
  return { record, wrapper }
}
