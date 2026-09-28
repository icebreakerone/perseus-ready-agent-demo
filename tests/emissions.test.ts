import { describe, expect, it } from 'vitest'
import { normalise, type Reading } from '@/lib/edp'
import { calculateMonthly, monthsIn, reportingWindow, toEmissionsReport, type MeterSeries } from '@/lib/emissions'
import { gasFactorAt } from '@/lib/factors'
import { chunks, slotKey } from '@/lib/intensity'

const HALF_HOUR = 30 * 60 * 1000

function series(from: string, to: string, value: number, unit: 'kWh' | 'm3' = 'kWh') {
  const out = []
  for (let t = Date.parse(from); t < Date.parse(to); t += HALF_HOUR)
    out.push({ from: new Date(t).toISOString().replace('.000Z', 'Z'), value, unit })
  return out
}

describe('reporting window', () => {
  it('is the last 12 completed calendar months', () => {
    const { from, to } = reportingWindow(new Date('2025-07-15T10:00:00Z'))
    // The guide's example: a report on 15 July 2025 covers 1 July 2024 to 30 June 2025
    expect(from.toISOString()).toBe('2024-07-01T00:00:00.000Z')
    expect(to.toISOString()).toBe('2025-07-01T00:00:00.000Z')
    expect(monthsIn(from, to)).toHaveLength(12)
  })
})

describe('units', () => {
  it('converts Wh to kWh and keeps m³', () => {
    const readings = [
      { from: 'a', to: 'b', type: 'electricity', energy: { unitCode: 'WHR', value: 1500 } },
      { from: 'a', to: 'b', type: 'gas', energy: { unitCode: 'MTQ', value: 0.2 } },
    ] as Reading[]
    expect(normalise(readings)).toEqual([
      { from: 'a', value: 1.5, unit: 'kWh' },
      { from: 'a', value: 0.2, unit: 'm3' },
    ])
  })
})

describe('gas factors', () => {
  it('uses the most recent factor published before consumption', () => {
    expect(gasFactorAt('2025-06-10T08:00:00Z').year).toBe(2024)
    expect(gasFactorAt('2025-06-10T09:00:00Z').year).toBe(2025)
    expect(gasFactorAt('2026-08-01T00:00:00Z').year).toBe(2026)
  })
})

describe('NESO chunking', () => {
  it('keeps every request under 14 days and covers the window', () => {
    const from = new Date('2025-09-01T00:00:00Z')
    const to = new Date('2026-09-01T00:00:00Z')
    const parts = chunks(from, to)
    expect(parts[0][0]).toEqual(from)
    expect(parts.at(-1)![1]).toEqual(to)
    for (const [a, b] of parts) expect(b.getTime() - a.getTime()).toBeLessThan(14 * 24 * 3600 * 1000)
    for (let i = 1; i < parts.length; i++) expect(parts[i][0]).toEqual(parts[i - 1][1])
  })

  it('joins readings and slots on start time', () => {
    expect(slotKey('2025-09-01T00:00:00Z')).toBe('2025-09-01T00:00Z')
  })
})

describe('monthly calculation', () => {
  const window = { from: new Date('2025-05-01T00:00:00Z'), to: new Date('2025-08-01T00:00:00Z') }

  it('reports whole months only', () => {
    // Data from 15 May to 26 July: only June is whole
    const meters: MeterSeries[] = [
      { id: 'e', type: 'electricity', readings: series('2025-05-15T00:00:00Z', '2025-07-26T00:00:00Z', 1) },
    ]
    const intensity = Object.fromEntries(meters[0].readings.map((r) => [slotKey(r.from), 200]))
    const months = calculateMonthly(meters, intensity, window)
    expect(months.map((m) => m.month)).toEqual(['2025-06'])
    // 1440 half-hours × 1 kWh × 200 g/kWh = 288 kg
    expect(months[0].totalKgCO2e).toBeCloseTo(288)
    expect(months[0].complete).toBe(true)
  })

  it('sums meters and flags missing half-hours', () => {
    const elec = series('2025-06-01T00:00:00Z', '2025-07-01T00:00:00Z', 2)
    const gas = series('2025-06-01T00:00:00Z', '2025-07-01T00:00:00Z', 0.1, 'm3')
    const intensity = Object.fromEntries(elec.map((r) => [slotKey(r.from), 100]))
    delete intensity[slotKey(elec[10].from)]
    const months = calculateMonthly(
      [
        { id: 'e', type: 'electricity', readings: elec },
        { id: 'g', type: 'gas', readings: gas },
      ],
      intensity,
      window,
    )
    expect(months).toHaveLength(1)
    const [june] = months
    const electricity = june.fuels.find((f) => f.type === 'electricity')!
    const gasMonth = june.fuels.find((f) => f.type === 'gas')!
    expect(electricity.unmatchedSlots).toBe(1)
    expect(electricity.kgCO2e).toBeCloseTo((1440 - 1) * 2 * 0.1)
    // June 2025 is after the 2025 factors were published on 10 June only in part
    const expectedGas = gas.reduce((sum, r) => sum + r.value * gasFactorAt(r.from).perCubicMetre, 0)
    expect(gasMonth.kgCO2e).toBeCloseTo(expectedGas)
    expect(june.totalKgCO2e).toBeCloseTo(electricity.kgCO2e + gasMonth.kgCO2e)
    expect(june.complete).toBe(false)

    const api = toEmissionsReport(months, '2025-08-02T00:00:00Z')
    expect(api).toHaveLength(2)
    expect(api[0]).toMatchObject({ from: '2025-06-01T00:00:00Z', to: '2025-07-01T00:00:00Z', emissions: { unitCode: 'KGM' } })
  })
})
