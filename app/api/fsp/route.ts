import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api'
import { config } from '@/lib/config'
import { getMember, memberIdentifier } from '@/lib/directory'
import { Recorder } from '@/lib/http'
import { Session } from '@/lib/session'

// The FSP's start link may name the FSP by its Directory member URL. It is
// only accepted if the Directory confirms the member has the FSP role.
export async function POST(req: Request) {
  const session = await Session.load()
  try {
    const { fsp } = (await req.json()) as { fsp?: string }
    if (!fsp || !fsp.startsWith(`${config.directoryUrl}/m/`)) throw new Error('Not a Directory member URL')
    if (session.state.steps.login) throw new Error('The FSP can only be chosen before signing in')
    const member = await getMember(new Recorder(), memberIdentifier(fsp))
    if (!member.roles.includes(config.roles.fsp)) throw new Error(`${member.legalName} is not a Financial Service Provider`)
    session.state.fspMemberUrl = member.id
    session.save()
    return NextResponse.json({ fspMemberUrl: member.id, name: member.legalName })
  } catch (err) {
    return errorResponse(err)
  }
}
