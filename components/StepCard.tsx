'use client'

import type { ClientState } from './types'
import type { StepResult } from '@/lib/session'
import type { StepDefinition, StepStatus } from '@/lib/steps'
import { AuthoriseAction, LoginForm, PermissionForm } from './UserActions'

const ICONS: Record<StepStatus, string> = { pending: '', running: '', done: '✓', failed: '✗', action: '!' }

interface Props {
  number: number
  definition: StepDefinition
  result?: StepResult
  running: boolean
  isNext: boolean
  state: ClientState
  onRetry: () => void
  onChange: () => Promise<void>
}

export function StepCard({ number, definition, result, running, isNext, state, onRetry, onChange }: Props) {
  let status: StepStatus = result?.status ?? 'pending'
  if (running) status = 'running'
  else if (isNext && definition.kind === 'user' && status === 'pending') status = 'action'

  return (
    <li className={`step ${status}`} id={definition.id}>
      <div className="icon" aria-label={status}>
        {status === 'running' ? '' : ICONS[status] || number}
      </div>
      <div>
        <h2>
          {definition.title}
          {definition.kind === 'user' && <span className="kind">Needs the SME</span>}
        </h2>
        <p className="description">{definition.description}</p>
      </div>
      <div className="body">
        {result?.summary && status !== 'failed' && <p className="summary">{result.summary}</p>}
        {result?.error && <p className="error">{result.error}</p>}

        {isNext && !running && definition.id === 'login' && <LoginForm onDone={onChange} />}
        {isNext && !running && definition.id === 'permission' && <PermissionForm state={state} onDone={onChange} />}
        {isNext && !running && definition.id === 'authorise' && <AuthoriseAction state={state} result={result} />}
        {status === 'failed' && definition.kind === 'auto' && (
          <p>
            <button onClick={onRetry}>Retry</button>
          </p>
        )}

        {result?.facts && Object.keys(result.facts).length > 0 && (
          <dl className="facts">
            {Object.entries(result.facts).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {result?.deviations?.map((d) => (
          <p className="deviation" key={d}>
            <strong>Sandbox note:</strong> {d}
          </p>
        ))}
        {result?.evidence && result.evidence.length > 0 && (
          <details className="evidence">
            <summary>Evidence: {result.evidence.length} recorded exchanges</summary>
            {result.evidence.map((e, i) => (
              <div className="exchange" key={i}>
                <div className="line">
                  {e.mtls && <span className="tag">mTLS</span>}
                  {e.method === 'NOTE' ? (
                    <strong>{e.label}</strong>
                  ) : (
                    <>
                      <strong>{e.label}</strong>: {e.method} {e.url} → {e.status ?? e.error ?? '…'}
                      {e.durationMs !== undefined && ` (${e.durationMs} ms)`}
                    </>
                  )}
                </div>
                {e.requestBody && <pre>{e.requestBody}</pre>}
                {e.responseBody && <pre>{e.responseBody}</pre>}
              </div>
            ))}
          </details>
        )}
        <div className="refs">
          {definition.references.map((r) => (
            <a key={r.url} href={r.url} target="_blank" rel="noreferrer">
              {r.label} ↗
            </a>
          ))}
        </div>
      </div>
    </li>
  )
}
