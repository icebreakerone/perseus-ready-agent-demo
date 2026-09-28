// NESO Carbon Intensity API, regional half-hourly forecast by postcode outcode.
// https://carbon-intensity.github.io/api-definitions/
import type { Recorder } from './http'

const BASE = 'https://api.carbonintensity.org.uk'
// The API refuses ranges of 14 days or more.
const CHUNK_DAYS = 13
const DAY = 24 * 60 * 60 * 1000

interface RegionalResponse {
  data: {
    regionid: number
    shortname: string
    postcode: string
    data: { from: string; to: string; intensity: { forecast: number; index: string } }[]
  }
}

export interface IntensitySeries {
  outcode: string
  region: string
  // Slot start (ISO, minute precision, Z) → gCO2/kWh
  slots: Record<string, number>
  requests: number
}

const neso = (d: Date) => d.toISOString().slice(0, 16) + 'Z'

// Normalises any ISO timestamp to the API's minute-precision form so readings
// and intensity slots can be joined on their start time.
export const slotKey = (iso: string) => neso(new Date(iso))

export function chunks(from: Date, to: Date): [Date, Date][] {
  const out: [Date, Date][] = []
  for (let start = from.getTime(); start < to.getTime(); start += CHUNK_DAYS * DAY) {
    out.push([new Date(start), new Date(Math.min(start + CHUNK_DAYS * DAY, to.getTime()))])
  }
  return out
}

export async function fetchIntensity(rec: Recorder, outcode: string, from: Date, to: Date): Promise<IntensitySeries> {
  const series: IntensitySeries = { outcode, region: '', slots: {}, requests: 0 }
  for (const [start, end] of chunks(from, to)) {
    const url = `${BASE}/regional/intensity/${neso(start)}/${neso(end)}/postcode/${encodeURIComponent(outcode)}`
    const body = await rec.json<RegionalResponse>(`Grid intensity ${neso(start).slice(0, 10)}`, url)
    series.requests++
    series.region = body.data.shortname
    for (const slot of body.data.data) {
      // Each response starts with the slot ending at `from`; keep only slots
      // inside the window.
      const t = new Date(slot.from).getTime()
      if (t >= from.getTime() && t < to.getTime()) series.slots[slotKey(slot.from)] = slot.intensity.forecast
    }
  }
  return series
}
