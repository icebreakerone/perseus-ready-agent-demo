// DESNZ greenhouse gas reporting conversion factors for natural gas (Scope 1,
// kg CO2e). The gas emissions calculation uses "the most recent published
// greenhouse gas conversion factor for natural gas covering the time of
// consumption"; there is no API, so the published values are recorded here.
// Values from each year's flat file on gov.uk; checked 2026-09-23.

export interface GasFactorSet {
  year: number
  published: string
  source: string
  perCubicMetre: number
  perKwhGrossCv: number
}

export const GAS_FACTORS: GasFactorSet[] = [
  {
    year: 2024,
    published: '2024-07-08T00:00:00+01:00',
    source: 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2024',
    perCubicMetre: 2.04542,
    perKwhGrossCv: 0.1829,
  },
  {
    year: 2025,
    published: '2025-06-10T09:30:03+01:00',
    source: 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025',
    perCubicMetre: 2.06672,
    perKwhGrossCv: 0.18296,
  },
  {
    year: 2026,
    published: '2026-06-11T09:30:00+01:00',
    source: 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026',
    perCubicMetre: 2.02633,
    perKwhGrossCv: 0.18231,
  },
]

export function gasFactorAt(when: string | Date): GasFactorSet {
  const t = new Date(when).getTime()
  const applicable = GAS_FACTORS.filter((f) => new Date(f.published).getTime() <= t)
  if (applicable.length === 0) throw new Error(`No gas conversion factor published before ${new Date(when).toISOString()}`)
  return applicable[applicable.length - 1]
}
