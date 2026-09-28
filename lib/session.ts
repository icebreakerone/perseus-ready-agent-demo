import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { cookies } from 'next/headers'
import { config } from './config'
import type { Evidence } from './http'
import type { StepId, StepStatus } from './steps'

const COOKIE = 'perseus_demo_session'

export interface StepResult {
  status: StepStatus
  completedAt?: string
  summary?: string
  // Key facts shown on the card, e.g. { "Client ID": "https://…" }
  facts?: Record<string, string>
  // Places where the sandbox forced us to diverge from the specification
  deviations?: string[]
  error?: string
  evidence?: Evidence[]
}

export interface SessionState {
  createdAt: string
  fspMemberUrl: string
  steps: Partial<Record<StepId, StepResult>>
  user?: { username: string; name: string; id: string; loggedInAt: string }
  names?: { cap: string; edp: string; fsp: string }
  edp?: {
    memberUrl: string
    resourceBase: string
    issuer: string
    authorizationEndpoint: string
    parEndpoint: string
    tokenEndpoint: string
    permissionEndpoint?: string
    privacyPolicy?: string
  }
  permission?: PermissionGrant
  oauth?: { state: string; codeVerifier: string; startedAt: string }
  tokens?: { accessToken: string; refreshToken?: string; expiresAt: string; scope?: string }
  permissionRecord?: Record<string, unknown>
}

export interface PermissionGrant {
  id: string
  timestamp: string
  user: string
  ip: string
  userAgent: string
  license: string
  permissionText: string
  fsp: string
}

let secret: Buffer | undefined
function sessionSecret(): Buffer {
  if (!secret) {
    const configured = process.env.SESSION_SECRET
    if (!configured) console.warn('SESSION_SECRET is not set; sessions will not survive a restart')
    secret = configured ? Buffer.from(configured) : randomBytes(32)
  }
  return secret
}

const sign = (id: string) => createHmac('sha256', sessionSecret()).update(id).digest('base64url')

function verifyCookie(value: string | undefined): string | undefined {
  if (!value) return undefined
  const [id, mac] = value.split('.')
  if (!id || !mac || !/^[A-Za-z0-9_-]+$/.test(id)) return undefined
  const expected = Buffer.from(sign(id))
  const given = Buffer.from(mac)
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : undefined
}

const sessionDir = (id: string) => path.join(config.dataDir, 'sessions', id)

export class Session {
  private constructor(
    readonly id: string,
    public state: SessionState,
  ) {}

  // Loads the session named by the cookie, creating one if needed. Route
  // handlers only: creating a session sets a cookie.
  static async load(): Promise<Session> {
    const jar = await cookies()
    const id = verifyCookie(jar.get(COOKIE)?.value)
    if (id && existsSync(path.join(sessionDir(id), 'state.json'))) {
      const state = JSON.parse(readFileSync(path.join(sessionDir(id), 'state.json'), 'utf8'))
      return new Session(id, state)
    }
    const session = Session.create()
    jar.set(COOKIE, `${session.id}.${sign(session.id)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.appUrl.startsWith('https:'),
      path: '/',
    })
    return session
  }

  // Read-only lookup for server components, which cannot set cookies.
  static async peek(): Promise<Session | undefined> {
    const jar = await cookies()
    const id = verifyCookie(jar.get(COOKIE)?.value)
    if (!id || !existsSync(path.join(sessionDir(id), 'state.json'))) return undefined
    return new Session(id, JSON.parse(readFileSync(path.join(sessionDir(id), 'state.json'), 'utf8')))
  }

  private static create(): Session {
    const session = new Session(randomBytes(18).toString('base64url'), {
      createdAt: new Date().toISOString(),
      fspMemberUrl: config.defaultFspMemberUrl,
      steps: {},
    })
    session.save()
    return session
  }

  save() {
    mkdirSync(sessionDir(this.id), { recursive: true })
    writeFileSync(path.join(sessionDir(this.id), 'state.json'), JSON.stringify(this.state, null, 2))
  }

  // Bulky artefacts (readings, intensity series, provenance) live beside the
  // state rather than in it.
  writeBlob(name: string, value: unknown) {
    mkdirSync(sessionDir(this.id), { recursive: true })
    writeFileSync(path.join(sessionDir(this.id), `${name}.json`), JSON.stringify(value))
  }

  readBlob<T>(name: string): T {
    const file = path.join(sessionDir(this.id), `${name}.json`)
    if (!existsSync(file)) throw new Error(`Missing ${name}; run the earlier steps first`)
    return JSON.parse(readFileSync(file, 'utf8')) as T
  }

  hasBlob(name: string): boolean {
    return existsSync(path.join(sessionDir(this.id), `${name}.json`))
  }

  reset() {
    const fsp = this.state.fspMemberUrl
    rmSync(sessionDir(this.id), { recursive: true, force: true })
    this.state = { createdAt: new Date().toISOString(), fspMemberUrl: fsp, steps: {} }
    this.save()
  }
}
