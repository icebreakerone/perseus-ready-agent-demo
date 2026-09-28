import { errorResponse } from '@/lib/api'
import type { Report } from '@/lib/runner'
import { Session } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const session = await Session.load()
  if (session.state.steps.report?.status !== 'done') return errorResponse('The report has not been created yet', 404)
  const report = session.readBlob<Report>('report')

  let body: unknown
  if (kind === 'emissions') body = report.emissions
  else if (kind === 'provenance')
    body = { encoded: report.emissions.provenance, decoded: report.provenanceDecoded }
  else return errorResponse(`Unknown download ${kind}`, 404)

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${kind}-${report.preparedAt.slice(0, 10)}.json"`,
    },
  })
}
