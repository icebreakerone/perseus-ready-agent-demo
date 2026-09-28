import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { config } from '@/lib/config'
import { exchangeCode } from '@/lib/oauth'
import { record } from '@/lib/runner'
import { Session } from '@/lib/session'

export const dynamic = 'force-dynamic'

const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const trimSlash = (s: string) => s.replace(/\/$/, '')

// The redirect_uri registered in the PAR. Everything is checked before the
// code is used: our state (CSRF), and the issuer (RFC 9207, mix-up attacks).
export async function GET(req: NextRequest) {
  const session = await Session.load()
  const params = req.nextUrl.searchParams
  const pending = session.state.oauth
  const edp = session.state.edp
  const parEvidence = session.state.steps.authorise?.evidence ?? []

  await record(session, 'authorise', async (rec) => {
    rec.evidence.push(...parEvidence)
    rec.note('Authorisation response', `Redirected back with parameters: ${[...params.keys()].join(', ')}`)
    if (!pending || !edp) throw new Error('No authorisation request is in progress')
    session.state.oauth = undefined
    const state = params.get('state') ?? ''
    if (!equal(state, pending.state)) throw new Error('The state parameter does not match our request')
    const iss = params.get('iss')
    if (!iss) throw new Error('The authorisation response has no iss parameter, but the server advertises it')
    if (trimSlash(iss) !== trimSlash(edp.issuer)) throw new Error(`Response issuer ${iss} is not ${edp.issuer}`)
    const error = params.get('error')
    if (error) throw new Error(`The EDP returned ${error}: ${params.get('error_description') ?? ''}`)
    const code = params.get('code')
    if (!code) throw new Error('The authorisation response has no code')

    const tokens = await exchangeCode(rec, edp.tokenEndpoint, code, pending.codeVerifier)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    session.state.tokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scope: tokens.scope,
    }
    return {
      summary: 'Authorised: the EDP issued certificate-bound tokens.',
      facts: {
        'Access token expires': expiresAt,
        'Refresh token': tokens.refresh_token ? 'issued' : 'not issued',
        State: 'matched',
        Issuer: `${iss} (matched)`,
      },
    }
  })
  return NextResponse.redirect(`${config.appUrl}/#authorise`, 303)
}
