'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { StepResult } from '@/lib/session'
import type { ClientState } from './types'

async function post(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`)
  return json
}

export function LoginForm({ onDone }: { onDone: () => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await post('/api/login', { username, password })
      await onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form className="login" onSubmit={submit}>
        <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <button disabled={busy || !username || !password}>Sign in</button>
      </form>
      <p className="hint">Demo account: the DEMO_SME_USERNAME and DEMO_SME_PASSWORD from .env (default demo / perseus).</p>
      {error && <p className="error">{error}</p>}
    </>
  )
}

// Just enough Markdown for the Registry permission text: paragraphs, bullet
// lists, _emphasis_ and [links](url). Rendered as elements, never as HTML.
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /\[([^\]]+)\]\((https?:[^)]+)\)|_([^_]+)_|(https?:\/\/[^\s)]+)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(last, match.index))
    if (match[1]) parts.push(<a key={match.index} href={match[2]} target="_blank" rel="noreferrer">{match[1]}</a>)
    else if (match[3]) parts.push(<em key={match.index}>{match[3]}</em>)
    else parts.push(<a key={match.index} href={match[4]} target="_blank" rel="noreferrer">{match[4]}</a>)
    last = match.index! + match[0].length
  }
  parts.push(text.slice(last))
  return parts
}

function PermissionText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/)
  return (
    <div className="permission-text">
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim())
        const bullets = lines.filter((l) => l.trim().startsWith('* '))
        const intro = lines.filter((l) => !l.trim().startsWith('* '))
        return (
          <div key={i}>
            {intro.length > 0 && <p>{inline(intro.join(' '))}</p>}
            {bullets.length > 0 && (
              <ul>
                {bullets.map((b, j) => (
                  <li key={j}>{inline(b.trim().slice(2))}</li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function PermissionForm({ state, onDone }: { state: ClientState; onDone: () => Promise<void> }) {
  const [text, setText] = useState<{ text: string; source: string }>()
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/permission')
      .then(async (r) => (r.ok ? setText(await r.json()) : setError((await r.json()).error)))
      .catch((err) => setError(String(err)))
  }, [])

  const agree = async () => {
    setBusy(true)
    try {
      await post('/api/permission', { agree: true })
      await onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!text) return <p className="hint">Loading the permission text from the Registry…</p>
  return (
    <>
      <PermissionText text={text.text} />
      <p className="hint">
        Text from the{' '}
        <a href={text.source} target="_blank" rel="noreferrer">
          Registry
        </a>{' '}
        (content hash verified). Placeholders are filled from the Directory.
      </p>
      <label className="agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I agree to {state.names?.cap} accessing my energy data from {state.names?.edp} and sharing my emissions data
          with {state.names?.fsp}, as described above.
        </span>
      </label>
      <button disabled={!agreed || busy} onClick={agree}>
        Grant permission
      </button>
    </>
  )
}

export function AuthoriseAction({ state, result }: { state: ClientState; result?: StepResult }) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const { url } = await post('/api/auth/start')
      window.location.assign(url)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <p className="hint">
        You will be taken to {state.names?.edp} to sign in to your energy account and confirm the connection, then
        brought back here.
      </p>
      <button disabled={busy} onClick={start}>
        {result?.status === 'failed' || result?.status === 'action' ? 'Try again' : `Connect to ${state.names?.edp}`}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  )
}
