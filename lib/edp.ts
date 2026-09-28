// Perseus energy consumption data API
// https://registry.core.sandbox.trust.ib1.org/scheme/perseus/api/consumption-data@2026-03-12.json
import type { Recorder } from './http'
import type { EncodedRecord } from './provenance'

export interface Datasource {
  id: string
  type: 'electricity' | 'gas'
  location: { ukPostcodeOutcode: string }
  availableMeasures: ('import' | 'export')[]
}

interface Quantity {
  unitCode: 'KWH' | 'WHR' | 'MTQ'
  value: number
}

export interface Reading {
  from: string
  to: string
  takenAt?: string
  type: 'electricity' | 'gas'
  energy: Quantity
  cumulative?: Quantity
}

export interface MeterData {
  data: Reading[]
  location: { ukPostcodeOutcode: string }
  provenance: EncodedRecord
}

// Half-hourly values normalised to kWh, or m³ for gas measured by volume.
export interface NormalisedReading {
  from: string
  value: number
  unit: 'kWh' | 'm3'
}

const MAX_RETRIES = 5

export async function listDatasources(rec: Recorder, base: string, accessToken: string): Promise<Datasource[]> {
  const body = await rec.json<{ data: Datasource[] }>('List datasources', `${base}/datasources`, {
    mtls: true,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return body.data
}

export async function fetchReadings(
  rec: Recorder,
  base: string,
  accessToken: string,
  source: Datasource,
  measure: 'import' | 'export',
  from: Date,
  to: Date,
): Promise<{ url: string; body: MeterData }> {
  const service = `${base}/datasources/${encodeURIComponent(source.id)}/${measure}`
  const url = `${service}?from=${from.toISOString().replace('.000Z', 'Z')}&to=${to.toISOString().replace('.000Z', 'Z')}`
  for (let attempt = 0; ; attempt++) {
    const response = await rec.request(`Readings: ${source.type} ${measure}`, url, {
      mtls: true,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        // Windows over 60 days are only served compressed
        'Accept-Encoding': 'gzip',
      },
    })
    if (response.status === 200) return { url: service, body: response.json<MeterData>() }
    // 202: the EDP is still collecting the data; come back after Retry-After
    if (response.status === 202 && attempt < MAX_RETRIES) {
      const wait = Math.min(Number(response.headers.get('retry-after')) || 5, 30)
      rec.note('Data not ready', `HTTP 202, retrying in ${wait}s (attempt ${attempt + 1} of ${MAX_RETRIES})`)
      await new Promise((resolve) => setTimeout(resolve, wait * 1000))
      continue
    }
    throw new Error(`Readings for ${source.id}: HTTP ${response.status} ${response.text.slice(0, 300)}`)
  }
}

export function normalise(readings: Reading[]): NormalisedReading[] {
  return readings.map((r): NormalisedReading => {
    const { unitCode, value } = r.energy
    switch (unitCode) {
      case 'WHR':
        return { from: r.from, value: value / 1000, unit: 'kWh' }
      case 'KWH':
        return { from: r.from, value, unit: 'kWh' }
      case 'MTQ':
        if (r.type !== 'gas') throw new Error(`Cubic metres reported for ${r.type} at ${r.from}`)
        return { from: r.from, value, unit: 'm3' }
      default:
        throw new Error(`Unsupported unit ${unitCode as string} in reading at ${r.from}`)
    }
  })
}
