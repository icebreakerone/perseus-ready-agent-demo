import { readFileSync } from 'node:fs'
import { Agent, fetch as undiciFetch } from 'undici'
import { config } from './config'

export interface Evidence {
  label: string
  method: string
  url: string
  mtls: boolean
  status?: number
  durationMs?: number
  requestBody?: string
  responseBody?: string
  error?: string
}

const MAX_BODY = 4000
const SECRET_FIELDS = /("?(access_token|refresh_token|token|code|code_verifier)"?\s*[:=]\s*"?)([^"&\s,}]+)/g

// Tokens and codes never reach the evidence panel; everything else does, so
// a reviewer can see exactly what went over the wire.
export function redact(text: string): string {
  return text.replace(SECRET_FIELDS, (_, prefix) => `${prefix}[redacted]`)
}

function truncate(text: string): string {
  return text.length > MAX_BODY
    ? `${text.slice(0, MAX_BODY)}\n… (${text.length - MAX_BODY} more characters)`
    : text
}

let agent: Agent | undefined

// The client bundle must be leaf then Client Issuer intermediate: a leaf-only
// certificate fails the handshake. Server certificates are verified against
// the default public roots, as the EDP uses public-CA-issued TLS certificates.
function mtlsAgent(): Agent {
  if (!agent) {
    const leaf = readFileSync(config.certs.clientCert, 'utf8')
    const intermediate = readFileSync(`${config.certs.clientCaDir}/intermediate.pem`, 'utf8')
    agent = new Agent({
      connect: {
        cert: `${leaf.trim()}\n${intermediate.trim()}\n`,
        key: readFileSync(config.certs.clientKey, 'utf8'),
        minVersion: 'TLSv1.3',
      },
    })
  }
  return agent
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  mtls?: boolean
}

export interface HttpResponse {
  status: number
  headers: Headers
  text: string
  json<T = unknown>(): T
}

export class Recorder {
  readonly evidence: Evidence[] = []

  async request(label: string, url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const method = options.method ?? 'GET'
    const entry: Evidence = {
      label,
      method,
      url,
      mtls: Boolean(options.mtls),
      requestBody: options.body ? redact(options.body) : undefined,
    }
    this.evidence.push(entry)
    const started = Date.now()
    try {
      const response = await undiciFetch(url, {
        method,
        headers: options.headers,
        body: options.body,
        dispatcher: options.mtls ? mtlsAgent() : undefined,
        redirect: 'manual',
      })
      const text = await response.text()
      entry.status = response.status
      entry.durationMs = Date.now() - started
      entry.responseBody = truncate(redact(text))
      return {
        status: response.status,
        headers: response.headers as unknown as Headers,
        text,
        json<T>() {
          try {
            return JSON.parse(text) as T
          } catch {
            throw new Error(`${label}: expected JSON but got ${truncate(text).slice(0, 200)}`)
          }
        },
      }
    } catch (err) {
      entry.durationMs = Date.now() - started
      entry.error = describeError(err)
      throw new Error(`${label} failed: ${entry.error}`)
    }
  }

  async json<T>(label: string, url: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request(label, url, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
    })
    if (response.status < 200 || response.status >= 300)
      throw new Error(`${label}: HTTP ${response.status} ${truncate(response.text).slice(0, 300)}`)
    return response.json<T>()
  }

  note(label: string, detail: string) {
    this.evidence.push({ label, method: 'NOTE', url: '', mtls: false, responseBody: detail })
  }
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as Error & { cause?: unknown }).cause
  return cause instanceof Error ? `${err.message}: ${cause.message}` : err.message
}
