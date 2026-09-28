import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api'
import { Recorder } from '@/lib/http'
import { authorisationUrl, pkce, pushAuthorisationRequest } from '@/lib/oauth'
import { assertPrerequisites, invalidateFrom } from '@/lib/runner'
import { Session } from '@/lib/session'

// Starting the OAuth flow with the PAR is our assertion to the EDP that the
// SME has granted permission using the standard Perseus text, so it is only
// possible once the permission step is complete.
export async function POST() {
  const session = await Session.load()
  try {
    assertPrerequisites(session, 'authorise')
  } catch (err) {
    return errorResponse(err, 409)
  }
  const edp = session.state.edp!
  const rec = new Recorder()
  invalidateFrom(session, 'authorise')
  try {
    const { verifier, challenge } = pkce()
    const state = randomBytes(24).toString('base64url')
    const par = await pushAuthorisationRequest(rec, edp.parEndpoint, { state, codeChallenge: challenge })
    const status = rec.evidence.at(-1)?.status
    session.state.oauth = { state, codeVerifier: verifier, startedAt: new Date().toISOString() }
    session.state.tokens = undefined
    session.state.steps.authorise = {
      status: 'action',
      summary: 'Waiting for the SME to sign in at the EDP.',
      facts: { request_uri: par.request_uri, 'Expires in': `${par.expires_in}s` },
      deviations:
        status === 200 ? ['The PAR endpoint answered 200; RFC 9126 specifies 201 Created.'] : [],
      evidence: rec.evidence,
    }
    session.save()
    return NextResponse.json({ url: authorisationUrl(edp.authorizationEndpoint, par.request_uri) })
  } catch (err) {
    session.state.steps.authorise = {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      evidence: rec.evidence,
    }
    session.save()
    return errorResponse(err, 502)
  }
}
