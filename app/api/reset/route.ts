import { NextResponse } from 'next/server'
import { Session } from '@/lib/session'

export async function POST() {
  const session = await Session.load()
  session.reset()
  return NextResponse.json({ ok: true })
}
