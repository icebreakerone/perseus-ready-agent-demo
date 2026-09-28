import path from 'node:path'

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value === undefined || value === '')
    throw new Error(`Environment variable ${name} is not set`)
  return value
}

function envPath(name: string, fallback: string): string {
  return path.resolve(process.cwd(), env(name, fallback))
}

const directoryUrl = env('DIRECTORY_URL', 'https://directory.core.sandbox.trust.ib1.org')
const registryUrl = env('REGISTRY_URL', 'https://registry.core.sandbox.trust.ib1.org')
const scheme = `${registryUrl}/scheme/perseus`
const capApplicationId = env('CAP_APPLICATION_ID', 'ciro1gll')
const appUrl = env('APP_URL', 'http://localhost:3000').replace(/\/$/, '')

export const config = {
  appUrl,
  // Fixed, never built from request input, so the callback can't become an
  // open redirect.
  redirectUri: `${appUrl}/api/auth/callback`,

  directoryUrl,
  registryUrl,
  trustFramework: `${registryUrl}/trust-framework`,
  scheme,

  capMemberId: env('CAP_MEMBER_ID', '4tnapijm'),
  capApplicationId,
  // The OAuth client_id is our application's Directory URL, which is also the
  // SAN URI of our client certificate.
  clientId: `${directoryUrl}/a/${capApplicationId}`,
  edpMemberId: env('EDP_MEMBER_ID', '7a1qv915'),
  defaultFspMemberUrl: env('FSP_MEMBER_URL', `${directoryUrl}/m/3vbfb8c1`),
  edpResourceBaseOverride: process.env.EDP_RESOURCE_BASE_OVERRIDE || undefined,

  roles: {
    cap: `${scheme}/role/carbon-accounting-provider`,
    edp: `${scheme}/role/energy-data-provider`,
    fsp: `${scheme}/role/financial-service-provider`,
  },

  // The single licence the SME grants in the FSP-initiated, one-permission
  // flow. It is also the OAuth scope.
  license: `${scheme}/license/energy-consumption-emissions-edp-cap-fsp/2026-03-12`,
  consumptionStandard: `${scheme}/standard/energy-consumption-data/2026-03-12`,
  emissionsStandard: `${scheme}/standard/emissions-report/2026-03-12`,
  processes: {
    electricity: `${scheme}/process/electricity-emissions-calculation/2026-03-12`,
    gas: `${scheme}/process/gas-emissions-calculation/2026-03-12`,
  },
  sourceTypes: {
    gridIntensity: `${scheme}/source-type/GridCarbonIntensity`,
    gasFactor: `${scheme}/source-type/GasGreenhouseGasFactor`,
  },
  missingData: {
    complete: `${scheme}/assurance/missing-data/Complete`,
    missing: `${scheme}/assurance/missing-data/Missing`,
  },

  certs: {
    clientCert: envPath('CLIENT_CERT_PATH', `certs/${capApplicationId}-client-cert.pem`),
    clientKey: envPath('CLIENT_KEY_PATH', `certs/${capApplicationId}-client-key.pem`),
    clientCaDir: envPath('CLIENT_CA_DIR', 'certs/directory-client-certificates'),
    signingCert: envPath('SIGNING_CERT_PATH', `certs/${capApplicationId}-signing-cert.pem`),
    signingKey: envPath('SIGNING_KEY_PATH', `certs/${capApplicationId}-signing-key.pem`),
    signingCaDir: envPath('SIGNING_CA_DIR', 'certs/directory-signing-certificates'),
  },

  sme: {
    username: env('DEMO_SME_USERNAME', 'demo'),
    password: env('DEMO_SME_PASSWORD', 'perseus'),
    name: env('DEMO_SME_NAME', 'Acme Bakery Ltd'),
    id: env('DEMO_SME_ID', 'SME-000123'),
  },

  dataDir: path.resolve(process.cwd(), '.data'),
}

export const memberUrl = (id: string) => `${config.directoryUrl}/m/${id}`
export const capMemberUrl = () => memberUrl(config.capMemberId)
export const edpMemberUrl = () => memberUrl(config.edpMemberId)
