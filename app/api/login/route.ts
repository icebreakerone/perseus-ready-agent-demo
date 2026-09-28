import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api'
import { config } from '@/lib/config'
import { displayName, getMember, memberIdentifier } from '@/lib/directory'
import { assertPrerequisites, record } from '@/lib/runner'
import { Session } from '@/lib/session'

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

// The SME's own account with us, the CAP. A real service would have proper
// account management; the demo has a single configured account.
export async function POST(req: Request) {
  const session = await Session.load()
  try {
    assertPrerequisites(session, 'login')
  } catch (err) {
    return errorResponse(err, 409)
  }
  const { username = '', password = '' } = (await req.json()) as { username?: string; password?: string }
  if (!same(username, config.sme.username) || !same(password, config.sme.password))
    return errorResponse('Incorrect username or password', 401)

  const result = await record(session, 'login', async (rec) => {
    const fsp = await getMember(rec, memberIdentifier(session.state.fspMemberUrl), 'Directory member (FSP)')
    if (!fsp.roles.includes(config.roles.fsp)) throw new Error(`${fsp.legalName} is not a Financial Service Provider`)
    session.state.names = { cap: '', edp: '', ...session.state.names, fsp: displayName(fsp) }
    session.state.user = {
      username,
      name: config.sme.name,
      id: config.sme.id,
      loggedInAt: new Date().toISOString(),
    }
    return {
      summary: `Signed in as ${config.sme.name}, sharing with ${displayName(fsp)}.`,
      facts: { SME: `${config.sme.name} (${config.sme.id})`, 'Financial Service Provider': `${displayName(fsp)} (${fsp.id})` },
    }
  })
  return NextResponse.json(result)
}
