'use client'

import { useEffect, useState } from 'react'
import type { Month } from '@/lib/emissions'
import type { GasFactorSet } from '@/lib/factors'
import type { SignerInfo, Step } from '@/lib/provenance'

interface ReportData {
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
  gasFactors: GasFactorSet[]
  provenanceDecoded: Step[]
}

const kg = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const tonnes = (n: number) => (n / 1000).toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const monthName = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

function describeStep(step: Step): string {
  switch (step.type) {
    case 'permission':
      return `Permission granted by the SME (account ${String(step.account).slice(0, 12)}…), expires ${String(step.expires).slice(0, 10)}`
    case 'origin':
      return `Origin: ${step.sourceType ? String(step.sourceType).split('/').pop() : 'data'} from ${step.origin}`
    case 'transfer':
      return `Transfer to ${step.to}`
    case 'receipt':
      return 'Receipt of the transferred consumption data'
    case 'process':
      return `Processed: ${String(step.process).split('/').slice(-2, -1)[0]}`
    default:
      return step.type
  }
}

export function Report() {
  const [report, setReport] = useState<ReportData>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    fetch('/api/report')
      .then(async (r) => (r.ok ? setReport(await r.json()) : setError((await r.json()).error)))
      .catch((err) => setError(String(err)))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!report) return null

  const fuels = [...new Set(report.months.flatMap((m) => m.fuels.map((f) => f.type)))]
  const fuelTotal = (type: string) =>
    report.months.reduce((sum, m) => sum + (m.fuels.find((f) => f.type === type)?.kgCO2e ?? 0), 0)
  const signer = (s: Step): SignerInfo | undefined => s._signature?.signed

  return (
    <section className="report" id="report">
      <h2>Carbon emissions report</h2>
      <p className="hint">Prepared {new Date(report.preparedAt).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</p>
      <div className="for">
        Prepared for: {report.fsp.name}. Not licensed for use by any other Financial Service Provider.
      </div>

      <div className="grid">
        <div><span>Business</span>{report.sme.name} ({report.sme.id})</div>
        <div><span>Prepared by</span>{report.cap.name}</div>
        <div><span>Consumption period</span>{day(report.period.from)} to {day(new Date(new Date(report.period.to).getTime() - 1).toISOString())}</div>
        <div><span>Data source</span>{report.edp.name}, smart meter half-hourly data</div>
        <div><span>Missing data</span>{report.complete ? 'None: every half-hour present' : 'Some half-hours missing; see table'}</div>
        <div><span>Permission ID</span><code>{report.permission.id}</code></div>
      </div>

      <h3>Monthly emissions (CO2e)</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              {fuels.map((f) => <th key={f} style={{ textTransform: 'capitalize' }}>{f} (kg)</th>)}
              <th>Total (kg)</th>
              <th>Total (t)</th>
              <th>Complete</th>
            </tr>
          </thead>
          <tbody>
            {report.months.map((m) => (
              <tr key={m.month}>
                <td>{monthName(m.month)}</td>
                {fuels.map((f) => {
                  const fuel = m.fuels.find((x) => x.type === f)
                  return <td key={f}>{fuel ? kg(fuel.kgCO2e) : '–'}</td>
                })}
                <td>{kg(m.totalKgCO2e)}</td>
                <td>{tonnes(m.totalKgCO2e)}</td>
                <td>{m.complete ? '✓' : 'Missing'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {fuels.map((f) => <td key={f}>{kg(fuelTotal(f))}</td>)}
              <td>{kg(report.totalKgCO2e)}</td>
              <td>{tonnes(report.totalKgCO2e)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <h3>Method</h3>
      <p className="method">
        <strong>Electricity:</strong> the sum of the products of the half-hourly consumption and the corresponding
        regional grid carbon intensity (NESO Carbon Intensity API) at the meter&rsquo;s postcode outcode.
      </p>
      {fuels.includes('gas') && (
        <p className="method">
          <strong>Gas:</strong> half-hourly consumption × the most recent DESNZ greenhouse gas conversion factor for
          natural gas published before the time of consumption (
          {report.gasFactors.map((f) => `${f.year}: ${f.perCubicMetre} kgCO2e/m³`).join('; ')}).
        </p>
      )}

      <h3>Provenance</h3>
      <p className="method">
        Signed provenance record: {report.provenanceDecoded.length} steps, every signature verified against the
        Trust Framework signing CA.
      </p>
      <ul className="chain">
        {report.provenanceDecoded.map((s) => (
          <li key={s.id}>
            <span className="type">{s.type}</span>
            <span>
              {describeStep(s)}
              <br />
              <span className="who">Signed by {signer(s)?.name} ({signer(s)?.application})</span>
            </span>
          </li>
        ))}
      </ul>

      <h3>Sending this report</h3>
      <p className="method">
        Send the two files below to {report.fsp.name}. The emissions data is in the Perseus emissions report format,
        and the provenance record ends with a Transfer step to {report.fsp.name} ({report.fsp.member}), so they can
        verify where every figure came from.
      </p>
      <div className="downloads">
        <a href="/api/download/emissions">Download emissions data (JSON)</a>
        <a href="/api/download/provenance">Download provenance record (JSON)</a>
      </div>
    </section>
  )
}
