// The Perseus emissions calculations. Electricity: "the sum of the products of
// the half-hourly consumption and the corresponding grid intensity at the
// meter postcode". Gas: consumption × the DESNZ natural gas conversion factor
// covering the time of consumption. Results are whole calendar months only.
import type { NormalisedReading } from './edp'
import { gasFactorAt } from './factors'
import { slotKey } from './intensity'

const HALF_HOUR = 30 * 60 * 1000

export type Fuel = 'electricity' | 'gas'

export interface MeterSeries {
  id: string
  type: Fuel
  readings: NormalisedReading[]
}

export interface FuelMonth {
  type: Fuel
  kgCO2e: number
  consumption: number
  unit: string
  expectedSlots: number
  // Half-hours with a reading, summed over this fuel's meters
  readingSlots: number
  // Readings we could not convert because the factor was missing
  unmatchedSlots: number
  meters: number
}

export interface Month {
  month: string // YYYY-MM
  from: string
  to: string
  fuels: FuelMonth[]
  totalKgCO2e: number
  complete: boolean
}

// The last 12 completed calendar months before `now` (UTC).
export function reportingWindow(now = new Date()): { from: Date; to: Date } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1))
  return { from, to }
}

export function monthsIn(from: Date, to: Date): { key: string; from: Date; to: Date }[] {
  const months = []
  for (let d = new Date(from); d < to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    months.push({ key: d.toISOString().slice(0, 7), from: d, to: end })
  }
  return months
}

// Only whole months are reported: a month is included when the combined
// data covers it from its first to its last half-hour.
function coveredMonths(meters: MeterSeries[], window: { from: Date; to: Date }) {
  let first = Infinity
  let last = -Infinity
  for (const m of meters)
    for (const r of m.readings) {
      const t = new Date(r.from).getTime()
      if (t < first) first = t
      if (t > last) last = t
    }
  if (first === Infinity) return []
  const lastEnd = last + HALF_HOUR
  return monthsIn(window.from, window.to).filter(
    (m) => m.from.getTime() >= first && m.to.getTime() <= lastEnd,
  )
}

export function calculateMonthly(
  meters: MeterSeries[],
  intensity: Record<string, number>,
  window: { from: Date; to: Date },
): Month[] {
  const months = coveredMonths(meters, window)
  const byMonth = new Map(months.map((m) => [m.key, new Map<Fuel, FuelMonth>()]))

  for (const meter of meters) {
    for (const reading of meter.readings) {
      const key = reading.from.slice(0, 7)
      const fuels = byMonth.get(key)
      if (!fuels) continue
      let entry = fuels.get(meter.type)
      if (!entry) {
        entry = {
          type: meter.type,
          kgCO2e: 0,
          consumption: 0,
          unit: reading.unit === 'm3' ? 'm³' : 'kWh',
          expectedSlots: 0,
          readingSlots: 0,
          unmatchedSlots: 0,
          meters: 0,
        }
        fuels.set(meter.type, entry)
      }
      entry.readingSlots++
      entry.consumption += reading.value
      if (meter.type === 'electricity') {
        const g = intensity[slotKey(reading.from)]
        if (g === undefined) entry.unmatchedSlots++
        else entry.kgCO2e += (reading.value * g) / 1000 // gCO2/kWh → kg
      } else {
        const factor = gasFactorAt(reading.from)
        entry.kgCO2e += reading.value * (reading.unit === 'm3' ? factor.perCubicMetre : factor.perKwhGrossCv)
      }
    }
  }

  return months.map((m) => {
    const slotsInMonth = (m.to.getTime() - m.from.getTime()) / HALF_HOUR
    const fuels = [...(byMonth.get(m.key)?.values() ?? [])]
    for (const f of fuels) {
      f.meters = meters.filter((meter) => meter.type === f.type).length
      f.expectedSlots = slotsInMonth * f.meters
    }
    const complete = fuels.every((f) => f.readingSlots === f.expectedSlots && f.unmatchedSlots === 0)
    return {
      month: m.key,
      from: m.from.toISOString().replace('.000Z', 'Z'),
      to: m.to.toISOString().replace('.000Z', 'Z'),
      fuels,
      totalKgCO2e: fuels.reduce((sum, f) => sum + f.kgCO2e, 0),
      complete,
    }
  })
}

// The emissions data API shape, used for the report's data attachment.
export function toEmissionsReport(months: Month[], takenAt: string) {
  return months.flatMap((m) =>
    m.fuels.map((f) => ({
      type: f.type,
      from: m.from,
      to: m.to,
      takenAt,
      emissions: { value: Math.round(f.kgCO2e * 1000) / 1000, unitCode: 'KGM' as const },
    })),
  )
}
