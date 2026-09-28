import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api'
import { runStep } from '@/lib/runner'
import { Session } from '@/lib/session'
import { STEPS, type StepId } from '@/lib/steps'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(_req: Request, { params }: { params: Promise<{ step: string }> }) {
  const { step } = await params
  if (!STEPS.some((s) => s.id === step)) return errorResponse(`Unknown step ${step}`, 404)
  const session = await Session.load()
  try {
    return NextResponse.json(await runStep(session, step as StepId))
  } catch (err) {
    return errorResponse(err, 409)
  }
}
