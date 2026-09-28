import { existsSync, readFileSync } from 'node:fs'
import { capMemberUrl, config, edpMemberUrl } from './config'
import { identity, loadPem, verifyChain } from './certs'
import {
  displayName,
  getApplication,
  getMember,
  isMembershipActive,
  queryDataServices,
  type Member,
} from './directory'
import { fetchReadings, listDatasources, normalise, type Datasource, type NormalisedReading } from './edp'
import { calculateMonthly, reportingWindow, toEmissionsReport, type MeterSeries, type Month } from './emissions'
import { GAS_FACTORS } from './factors'
import { Recorder } from './http'
import { fetchIntensity, slotKey, type IntensitySeries } from './intensity'
import { discover, fetchPermissionRecord, mtlsEndpoint } from './oauth'
import { CertificateProvider, ProvenanceRecord, Signer, type EncodedRecord, type Step } from './provenance'
import type { Session, StepResult } from './session'
import { STEPS, stepIndex, type StepId } from './steps'

export interface Outcome {
  summary: string
  facts?: Record<string, string>
  deviations?: string[]
}

type Handler = (session: Session, rec: Recorder) => Promise<Outcome>

class CheckFailed extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailed(message)
}

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z')
// Minute precision, as the EDP records metering periods in provenance
const isoMinute = (d: Date) => d.toISOString().slice(0, 16) + 'Z'
const kg = (n: number) => `${n.toLocaleString('en-GB', { maximumFractionDigits: 1 })} kgCO2e`

// ---------------------------------------------------------------------------
// Certificates and signing

function signingProvider(): CertificateProvider {
  return CertificateProvider.fromRootPem(readFileSync(`${config.certs.signingCaDir}/root-ca.pem`, 'utf8'))
}

function signer(): Signer {
  const leaf = readFileSync(config.certs.signingCert, 'utf8')
  const intermediate = readFileSync(`${config.certs.signingCaDir}/intermediate.pem`, 'utf8')
  return Signer.fromFiles(signingProvider(), `${leaf.trim()}\n${intermediate.trim()}\n`, config.certs.signingKey)
}

async function checkCertificate(kind: 'client' | 'signing', facts: Record<string, string>) {
  const certPath = kind === 'client' ? config.certs.clientCert : config.certs.signingCert
  const keyPath = kind === 'client' ? config.certs.clientKey : config.certs.signingKey
  const caDir = kind === 'client' ? config.certs.clientCaDir : config.certs.signingCaDir
  for (const file of [certPath, keyPath, `${caDir}/root-ca.pem`, `${caDir}/intermediate.pem`])
    check(existsSync(file), `Missing ${file}. Run scripts/setup-certs.sh to obtain certificates from the Directory.`)

  const [leaf] = loadPem(certPath)
  const id = identity(leaf)
  const label = kind === 'client' ? 'Client' : 'Signing'
  check(id.application === config.clientId, `${label} certificate is for ${id.application}, expected ${config.clientId}`)
  check(id.member === capMemberUrl(), `${label} certificate names member ${id.member}, expected ${capMemberUrl()}`)
  check(id.roles.includes(config.roles.cap), `${label} certificate does not carry the Carbon Accounting Provider role`)
  const chain = [leaf, ...loadPem(`${caDir}/intermediate.pem`)]
  await verifyChain(chain, loadPem(`${caDir}/root-ca.pem`), new Date())

  facts[`${label} certificate`] = `serial ${id.serial}, valid until ${id.notAfter.toISOString().slice(0, 10)}`
  // The chain is only as good as its shortest-lived certificate
  const soonest = chain.reduce((a, b) => (a.notAfter < b.notAfter ? a : b))
  const days = Math.floor((soonest.notAfter.getTime() - Date.now()) / 86_400_000)
  return days < 60 ? `${label} certificate chain stops validating in ${days} days, when "${soonest.subject}" expires on ${soonest.notAfter.toISOString().slice(0, 10)}.` : undefined
}

// ---------------------------------------------------------------------------
// Step handlers

const directory: Handler = async (session, rec) => {
  const member = await getMember(rec, config.capMemberId)
  check(member.id === capMemberUrl(), `Directory returned ${member.id}, expected ${capMemberUrl()}`)
  check(member.roles.includes(config.roles.cap), 'Our organisation does not have the Carbon Accounting Provider role')

  const tf = member.trustFrameworkMemberships?.find((m) => m.membershipStatus === 'active')
  check(tf, 'No active Trust Framework membership')
  check(isMembershipActive(tf.membershipExpiry), `Trust Framework membership expired on ${tf.membershipExpiry}`)

  const perseus = member.schemeMemberships?.find((s) => s.scheme === config.scheme)
  check(perseus, 'Not a member of the Perseus scheme')
  check(perseus.orgRoles.includes(config.roles.cap), 'Perseus membership does not include the CAP role')
  const agreement = perseus.executions.find((e) => isMembershipActive(e.expiry))
  check(agreement, 'The Perseus Scheme Agreement has expired')

  session.state.names = { ...(session.state.names ?? { edp: '', fsp: '' }), cap: displayName(member) }
  return {
    summary: `${displayName(member)} is a Perseus Carbon Accounting Provider.`,
    facts: {
      Member: member.id,
      'Trust Framework': `${tf.trustFrameworkName}, active until ${tf.membershipExpiry}`,
      'Perseus agreement': `${agreement.agreement.name}, until ${agreement.expiry.slice(0, 10)}`,
    },
  }
}

const application: Handler = async (_session, rec) => {
  const app = await getApplication(rec, config.capApplicationId)
  check(app.id === config.clientId, `Directory returned ${app.id}, expected ${config.clientId}`)
  check(app.publisher === capMemberUrl(), `Application is published by ${app.publisher}, not us`)
  check(app.scheme === config.scheme, `Application is registered for ${app.scheme}, not Perseus`)
  check(app.role.includes(config.roles.cap), 'Application does not claim the Carbon Accounting Provider role')

  const facts: Record<string, string> = { Application: `${app.title} (${app.id})`, 'OAuth client_id': config.clientId }
  const warnings = [await checkCertificate('client', facts), await checkCertificate('signing', facts)]
  rec.note('Certificates', 'Both certificates chain to the Directory sandbox CAs and carry our application URL, member URL and CAP role.')
  return {
    summary: `"${app.title}" is registered, and its certificates are valid.`,
    facts,
    deviations: warnings.filter((w): w is string => Boolean(w)),
  }
}

const discovery: Handler = async (session, rec) => {
  const deviations: string[] = []
  const services = await queryDataServices(rec, config.consumptionStandard)
  const service = services.find((s) => s.publisher.replace(/\/$/, '').endsWith(`/m/${config.edpMemberId}`))
  check(service, `No data service conforming to the consumption data standard is published by member ${config.edpMemberId}`)
  if (service.publisher !== edpMemberUrl())
    deviations.push(`The catalogue lists the publisher as ${service.publisher}; the member URL is ${edpMemberUrl()}.`)

  const edp: Member = await getMember(rec, config.edpMemberId, 'Directory member (EDP)')
  check(edp.roles.includes(config.roles.edp), `${edp.legalName} does not have the Energy Data Provider role`)
  const perseus = edp.schemeMemberships?.find((s) => s.scheme === config.scheme)
  const current = perseus?.executions.some((e) => isMembershipActive(e.expiry))
  if (!current)
    deviations.push(
      `${edp.legalName}'s Perseus Scheme Agreement has expired (${perseus?.executions.map((e) => e.expiry.slice(0, 10)).join(', ') || 'none'}). In production we would not connect to it.`,
    )

  const metadata = await discover(rec, service.oauthIssuer)
  check(metadata.require_pushed_authorization_requests, 'Authorisation server does not require PAR')
  check(metadata.code_challenge_methods_supported?.includes('S256'), 'Authorisation server does not support PKCE S256')
  check(metadata.token_endpoint_auth_methods_supported?.includes('tls_client_auth'), 'Authorisation server does not support tls_client_auth')
  check(metadata.tls_client_certificate_bound_access_tokens, 'Access tokens are not certificate-bound')

  let resourceBase = service.endpointURL.replace(/\/$/, '').replace(/\/datasources$/, '')
  if (config.edpResourceBaseOverride) {
    deviations.push(
      `The Directory's endpointURL ${service.endpointURL} does not serve the API, so the configured ${config.edpResourceBaseOverride} is used instead.`,
    )
    resourceBase = config.edpResourceBaseOverride.replace(/\/$/, '')
  }

  session.state.edp = {
    memberUrl: edp.id,
    resourceBase,
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorization_endpoint,
    parEndpoint: mtlsEndpoint(metadata, 'pushed_authorization_request_endpoint')!,
    tokenEndpoint: mtlsEndpoint(metadata, 'token_endpoint')!,
    permissionEndpoint: mtlsEndpoint(metadata, 'ib1_permission_endpoint'),
    privacyPolicy: edp.privacyPolicy || undefined,
  }
  session.state.names = { ...(session.state.names ?? { cap: '', fsp: '' }), edp: displayName(edp) }
  return {
    summary: `Found "${service.title}" from ${displayName(edp)}.`,
    facts: {
      'Data service': service.title,
      'OAuth issuer': metadata.issuer,
      'PAR endpoint (mTLS)': session.state.edp.parEndpoint,
      'Token endpoint (mTLS)': session.state.edp.tokenEndpoint,
      'Data API (mTLS)': resourceBase,
    },
    deviations,
  }
}

const permissionRecord: Handler = async (session, rec) => {
  const { edp, tokens } = session.state
  check(edp?.permissionEndpoint, 'The EDP does not advertise an ib1_permission_endpoint')
  check(tokens?.refreshToken, 'No refresh token was issued, so the permission record cannot be retrieved')
  const { record, wrapper } = await fetchPermissionRecord(rec, edp.permissionEndpoint, tokens.refreshToken)
  check(record.license === config.license, `Permission is for ${record.license}, expected ${config.license}`)
  check(!record.client || record.client === config.clientId, `Permission was granted to ${record.client}`)
  check(!record.revoked, `Permission was revoked at ${record.revoked}`)
  session.state.permissionRecord = record as Record<string, unknown>
  const facts: Record<string, string> = {}
  for (const [k, v] of Object.entries(record)) if (v !== null && v !== undefined) facts[k] = String(v)
  return {
    summary: `The EDP holds a permission for our application under the one-permission licence, expiring ${record.expires ?? 'unknown'}.`,
    facts,
    deviations:
      wrapper === 'permissions'
        ? ['The response wraps the record as "permissions"; the Permission Records spec uses "permission".']
        : [],
  }
}

interface DataMeta {
  window: { from: string; to: string }
  outcode: string
  meters: { id: string; type: Datasource['type']; readings: number; receiptId: string; transferId: string; edpPermissionId: string }[]
}

// Checks the EDP's transfer step field by field, so a mismatch says exactly
// what differed rather than "no step matches".
function findEdpTransfer(record: ProvenanceRecord, expected: Record<string, unknown>): Step {
  const candidates = record.filterSteps({ type: 'transfer', to: config.clientId })
  check(candidates.length === 1, `Expected one transfer step to ${config.clientId} in the EDP's record, found ${candidates.length}`)
  const step = candidates[0]
  for (const [key, value] of Object.entries(expected)) {
    check(
      JSON.stringify(step[key]) === JSON.stringify(value),
      `EDP transfer step ${key} is ${JSON.stringify(step[key])}, expected ${JSON.stringify(value)}`,
    )
  }
  const signed = step._signature!.signed
  check(signed.member === edpMemberUrl(), `EDP record was signed by ${signed.member}, expected ${edpMemberUrl()}`)
  check(signed.roles.includes(config.roles.edp), 'EDP record signer lacks the Energy Data Provider role')
  return step
}

const data: Handler = async (session, rec) => {
  const { edp, tokens } = session.state
  check(edp && tokens, 'Not authorised with the EDP')
  const window = reportingWindow()
  const sources = await listDatasources(rec, edp.resourceBase, tokens.accessToken)
  check(sources.length > 0, 'The EDP returned no datasources for this account')

  const provider = signingProvider()
  const combined = new ProvenanceRecord(config.trustFramework)
  const meta: DataMeta = { window: { from: iso(window.from), to: iso(window.to) }, outcode: '', meters: [] }
  const facts: Record<string, string> = { Period: `${iso(window.from).slice(0, 10)} to ${iso(window.to).slice(0, 10)} (exclusive)` }

  for (const source of sources) {
    if (!source.availableMeasures.includes('import')) continue
    const { url, body } = await fetchReadings(rec, edp.resourceBase, tokens.accessToken, source, 'import', window.from, window.to)

    const edpRecord = new ProvenanceRecord(config.trustFramework, body.provenance as EncodedRecord)
    await edpRecord.verify(provider)
    const transfer = findEdpTransfer(edpRecord, {
      scheme: config.scheme,
      standard: config.consumptionStandard,
      license: config.license,
      service: url,
      path: '/readings',
      parameters: { measure: 'import', from: isoMinute(window.from), to: isoMinute(window.to) },
    })
    const edpPermissionId = (transfer.permissions as string[] | undefined)?.[0] ?? ''
    combined.addRecord(edpRecord)
    const receiptId = combined.addStep({ type: 'receipt', scheme: config.scheme, transfer: transfer.id })

    const readings: NormalisedReading[] = normalise(body.data)
    session.writeBlob(`readings-${source.type}-${meta.meters.length}`, { source, readings })
    meta.outcode ||= body.location?.ukPostcodeOutcode ?? source.location.ukPostcodeOutcode
    meta.meters.push({ id: source.id, type: source.type, readings: readings.length, receiptId, transferId: transfer.id, edpPermissionId })

    const expected = (window.to.getTime() - window.from.getTime()) / (30 * 60 * 1000)
    const total = readings.reduce((sum, r) => sum + r.value, 0)
    const unit = readings[0]?.unit === 'm3' ? 'm³' : 'kWh'
    facts[`${source.type} ${source.id}`] =
      `${readings.length.toLocaleString()} of ${expected.toLocaleString()} half-hours, ${total.toLocaleString('en-GB', { maximumFractionDigits: 0 })} ${unit}; provenance verified`
  }
  check(meta.meters.length > 0, 'No datasource offers the import measure')

  const signed = combined.sign(signer())
  session.writeBlob('provenance-1-receipt', signed.encoded())
  session.writeBlob('data-meta', meta)
  facts['Outcode'] = meta.outcode
  return {
    summary: `Retrieved ${meta.meters.length} meter${meta.meters.length > 1 ? 's' : ''} of half-hourly data, verified the EDP's signed provenance, and signed a Receipt.`,
    facts,
  }
}

const factors: Handler = async (session, rec) => {
  const meta = session.readBlob<DataMeta>('data-meta')
  const from = new Date(meta.window.from)
  const to = new Date(meta.window.to)
  const record = new ProvenanceRecord(config.trustFramework, session.readBlob<EncodedRecord>('provenance-1-receipt'))
  const facts: Record<string, string> = {}
  const origins: Record<string, string> = {}
  const period = { from: isoMinute(from), to: isoMinute(to) }

  if (meta.meters.some((m) => m.type === 'electricity')) {
    const series = await fetchIntensity(rec, meta.outcode, from, to)
    const expected = (to.getTime() - from.getTime()) / (30 * 60 * 1000)
    const found = Object.keys(series.slots).length
    session.writeBlob('intensity', series)
    origins.electricity = record.addStep({
      type: 'origin',
      scheme: config.scheme,
      sourceType: config.sourceTypes.gridIntensity,
      origin: 'https://api.carbonintensity.org.uk/',
      originLicense: 'https://creativecommons.org/licenses/by/4.0/',
      external: true,
      'perseus:scheme': { meteringPeriod: period, postcode: meta.outcode },
      'perseus:assurance': { missingData: found === expected ? config.missingData.complete : config.missingData.missing },
    })
    const values = Object.values(series.slots)
    facts['Grid intensity'] =
      `${found.toLocaleString()} of ${expected.toLocaleString()} half-hours for ${meta.outcode} (${series.region}), ${series.requests} requests; mean ${Math.round(values.reduce((a, b) => a + b, 0) / values.length)} gCO2/kWh`
  }
  if (meta.meters.some((m) => m.type === 'gas')) {
    const used = GAS_FACTORS.filter((f) => new Date(f.published) < to)
    origins.gas = record.addStep({
      type: 'origin',
      scheme: config.scheme,
      sourceType: config.sourceTypes.gasFactor,
      origin: used.at(-1)!.source,
      originLicense: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
      external: true,
      'perseus:scheme': { meteringPeriod: period },
      'perseus:assurance': { missingData: config.missingData.complete },
    })
    facts['Gas factors'] = used
      .slice(-2)
      .map((f) => `${f.year}: ${f.perCubicMetre} kgCO2e/m³ (from ${f.published.slice(0, 10)})`)
      .join('; ')
  }

  session.writeBlob('provenance-2-origins', record.sign(signer()).encoded())
  session.writeBlob('origins', origins)
  return { summary: 'Emission factors obtained and recorded as external Origin steps.', facts }
}

const calculate: Handler = async (session) => {
  const meta = session.readBlob<DataMeta>('data-meta')
  const origins = session.readBlob<Record<string, string>>('origins')
  const window = { from: new Date(meta.window.from), to: new Date(meta.window.to) }
  const meters: MeterSeries[] = meta.meters.map((m, i) => ({
    id: m.id,
    type: m.type,
    readings: session.readBlob<{ readings: NormalisedReading[] }>(`readings-${m.type}-${i}`).readings,
  }))
  const intensity = session.hasBlob('intensity') ? session.readBlob<IntensitySeries>('intensity').slots : {}
  const months = calculateMonthly(meters, intensity, window)
  check(months.length > 0, 'The data does not cover any whole calendar month')

  const record = new ProvenanceRecord(config.trustFramework, session.readBlob<EncodedRecord>('provenance-2-origins'))
  const processes: Record<string, string> = {}
  for (const type of ['electricity', 'gas'] as const) {
    const fuelMeters = meta.meters.filter((m) => m.type === type)
    if (fuelMeters.length === 0) continue
    const complete = months.every((m) => {
      const fuel = m.fuels.find((f) => f.type === type)
      return fuel !== undefined && fuel.readingSlots === fuel.expectedSlots && fuel.unmatchedSlots === 0
    })
    processes[type] = record.addStep({
      type: 'process',
      scheme: config.scheme,
      inputs: [...fuelMeters.map((m) => m.receiptId), origins[type]],
      process: config.processes[type],
      permissions: [...new Set(fuelMeters.map((m) => m.edpPermissionId))],
      'perseus:assurance': { missingData: complete ? config.missingData.complete : config.missingData.missing },
    })
  }
  session.writeBlob('provenance-3-process', record.sign(signer()).encoded())
  session.writeBlob('processes', processes)
  session.writeBlob('months', months)

  const total = months.reduce((sum, m) => sum + m.totalKgCO2e, 0)
  const incomplete = months.filter((m) => !m.complete).map((m) => m.month)
  // Spot check for the evidence panel: the first electricity half-hour
  const facts: Record<string, string> = {
    Months: `${months[0].month} to ${months.at(-1)!.month} (${months.length})`,
    Total: kg(total),
  }
  const firstElectric = meters.find((m) => m.type === 'electricity')?.readings[0]
  if (firstElectric) {
    const g = intensity[slotKey(firstElectric.from)]
    facts['Worked example'] = `${firstElectric.from}: ${firstElectric.value} kWh × ${g} gCO2/kWh = ${((firstElectric.value * g) / 1000).toFixed(4)} kgCO2e`
  }
  if (incomplete.length) facts['Months with missing data'] = incomplete.join(', ')
  return { summary: `Calculated ${months.length} whole months of emissions: ${kg(total)} in total.`, facts }
}

export interface Report {
  preparedAt: string
  cap: { name: string; member: string; application: string }
  sme: { name: string; id: string }
  fsp: { name: string; member: string }
  edp: { name: string; member: string }
  period: { from: string; to: string }
  permission: { id: string; grantedAt: string; license: string; edpPermissionId: string }
  months: Month[]
  totalKgCO2e: number
  complete: boolean
  gasFactors: typeof GAS_FACTORS
  emissions: { data: ReturnType<typeof toEmissionsReport>; provenance: EncodedRecord }
  provenanceDecoded: Step[]
}

const report: Handler = async (session) => {
  const { names, user, permission } = session.state
  check(names && user && permission, 'Earlier steps are incomplete')
  const meta = session.readBlob<DataMeta>('data-meta')
  const months = session.readBlob<Month[]>('months')
  const processes = session.readBlob<Record<string, string>>('processes')
  const record = new ProvenanceRecord(config.trustFramework, session.readBlob<EncodedRecord>('provenance-3-process'))

  const period = { from: months[0].from, to: months.at(-1)!.to }
  for (const [type, processId] of Object.entries(processes)) {
    record.addStep({
      type: 'transfer',
      scheme: config.scheme,
      of: processId,
      to: session.state.fspMemberUrl,
      standard: config.emissionsStandard,
      // The one-permission licence covers the onward transfer to the FSP the
      // SME named, so the CAP → FSP transfer is made under the same licence.
      license: config.license,
      service: config.appUrl,
      path: '/emissions',
      parameters: { type, from: period.from, to: period.to },
      permissions: [...new Set(meta.meters.filter((m) => m.type === type).map((m) => m.edpPermissionId))],
    })
  }
  const signed = record.sign(signer())
  // Check the finished record the way the FSP will
  const verified = new ProvenanceRecord(config.trustFramework, signed.encoded())
  await verified.verify(signingProvider())

  const preparedAt = iso(new Date())
  const total = months.reduce((sum, m) => sum + m.totalKgCO2e, 0)
  const result: Report = {
    preparedAt,
    cap: { name: names.cap, member: capMemberUrl(), application: config.clientId },
    sme: { name: user.name, id: user.id },
    fsp: { name: names.fsp, member: session.state.fspMemberUrl },
    edp: { name: names.edp, member: edpMemberUrl() },
    period,
    permission: {
      id: permission.id,
      grantedAt: permission.timestamp,
      license: permission.license,
      edpPermissionId: meta.meters[0].edpPermissionId,
    },
    months,
    totalKgCO2e: total,
    complete: months.every((m) => m.complete),
    gasFactors: GAS_FACTORS,
    emissions: { data: toEmissionsReport(months, preparedAt), provenance: signed.encoded() },
    provenanceDecoded: verified.decoded(),
  }
  session.writeBlob('report', result)
  return {
    summary: `Report prepared for ${names.fsp}: ${kg(total)} over ${months.length} months. Provenance record signed and verified (${result.provenanceDecoded.length} steps).`,
    facts: { 'Prepared for': `${names.fsp} (${session.state.fspMemberUrl})`, Total: kg(total) },
    deviations: [
      'The FSP transfer is made under the one-permission licence. The specifications do not say explicitly which licence applies to this transfer in the one-permission flow.',
    ],
  }
}

const HANDLERS: Partial<Record<StepId, Handler>> = {
  directory,
  application,
  discovery,
  'permission-record': permissionRecord,
  data,
  factors,
  calculate,
  report,
}

export function assertPrerequisites(session: Session, id: StepId) {
  const earlier = STEPS.slice(0, stepIndex(id))
  const blocking = earlier.find((s) => session.state.steps[s.id]?.status !== 'done')
  if (blocking) throw new Error(`Complete "${blocking.title}" first`)
}

// Clears this step and everything after it, so re-running a step never leaves
// later results built on stale data.
export function invalidateFrom(session: Session, id: StepId) {
  for (const s of STEPS.slice(stepIndex(id))) delete session.state.steps[s.id]
}

export async function record(session: Session, id: StepId, work: (rec: Recorder) => Promise<Outcome>): Promise<StepResult> {
  const rec = new Recorder()
  invalidateFrom(session, id)
  let result: StepResult
  try {
    const outcome = await work(rec)
    result = { status: 'done', completedAt: new Date().toISOString(), ...outcome, evidence: rec.evidence }
  } catch (err) {
    result = { status: 'failed', error: err instanceof Error ? err.message : String(err), evidence: rec.evidence }
  }
  session.state.steps[id] = result
  session.save()
  return result
}

export async function runStep(session: Session, id: StepId): Promise<StepResult> {
  const handler = HANDLERS[id]
  if (!handler) throw new Error(`"${id}" needs the user to act; it cannot be run automatically`)
  assertPrerequisites(session, id)
  return record(session, id, (rec) => handler(session, rec))
}
