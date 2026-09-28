import { NextResponse } from 'next/server'
import { Session } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await Session.load()
  const { steps, user, names, fspMemberUrl, permission } = session.state
  return NextResponse.json({
    steps,
    user: user ? { name: user.name, id: user.id } : undefined,
    names,
    fspMemberUrl,
    permission: permission ? { id: permission.id, timestamp: permission.timestamp } : undefined,
  })
}
