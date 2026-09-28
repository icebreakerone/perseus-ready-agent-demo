import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api'
import type { Report } from '@/lib/runner'
import { Session } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await Session.load()
  if (session.state.steps.report?.status !== 'done') return errorResponse('The report has not been created yet', 404)
  const report = session.readBlob<Report>('report')
  // The encoded record is only needed for the downloads
  const { emissions, ...rest } = report
  return NextResponse.json({ ...rest, emissions: { data: emissions.data } })
}
