import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api'
import { config } from '@/lib/config'
import { getMember, getPermissionText } from '@/lib/directory'
import { Recorder } from '@/lib/http'
import { logPermission } from '@/lib/permissionLog'
import { assertPrerequisites, record } from '@/lib/runner'
import { Session } from '@/lib/session'

// Placeholders are filled with brand.name, else legalName, from each
// organisation's Directory record, as the CAP guide requires.
async function renderPermissionText(session: Session, rec: Recorder) {
  const { names, edp } = session.state
  if (!names || !edp) throw new Error('Earlier steps are incomplete')
  const { text, url } = await getPermissionText(rec, config.license)
  const cap = await getMember(rec, config.capMemberId)
  const rendered = text
    .replaceAll('[CAP]', names.cap)
    .replaceAll('[EDP]', names.edp)
    .replaceAll('[FSP]', names.fsp)
    .replaceAll('[EDP privacy policy link]', edp.privacyPolicy ?? '(not published in the Directory)')
    .replaceAll('[CAP process]', `contacting us at ${cap.email}`)
  return { text: rendered, source: url }
}

export async function GET() {
  const session = await Session.load()
  try {
    assertPrerequisites(session, 'permission')
    return NextResponse.json(await renderPermissionText(session, new Recorder()))
  } catch (err) {
    return errorResponse(err, 409)
  }
}

export async function POST(req: Request) {
  const session = await Session.load()
  try {
    assertPrerequisites(session, 'permission')
  } catch (err) {
    return errorResponse(err, 409)
  }
  const { agree } = (await req.json()) as { agree?: boolean }
  if (agree !== true) return errorResponse('Permission must be explicitly agreed to', 400)

  const result = await record(session, 'permission', async (rec) => {
    const { text } = await renderPermissionText(session, rec)
    const grant = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      user: session.state.user!.username,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1',
      userAgent: req.headers.get('user-agent') ?? '',
      license: config.license,
      permissionText: text,
      fsp: session.state.fspMemberUrl,
    }
    logPermission(grant)
    session.state.permission = grant
    return {
      summary: `Permission granted and logged at ${grant.timestamp}.`,
      facts: {
        'Permission ID': grant.id,
        Licence: grant.license,
        'Logged': `user ${grant.user}, IP ${grant.ip}, user agent ${grant.userAgent.slice(0, 60)}…`,
      },
    }
  })
  return NextResponse.json(result)
}
