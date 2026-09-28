'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Report } from '@/components/Report'
import { StepCard } from '@/components/StepCard'
import type { ClientState } from '@/components/types'
import { STEPS, type StepId } from '@/lib/steps'

async function fetchState(): Promise<ClientState> {
  const response = await fetch('/api/state', { cache: 'no-store' })
  return response.json()
}

export default function Page() {
  const [state, setState] = useState<ClientState>()
  const [running, setRunning] = useState<StepId>()
  const [paused, setPaused] = useState(false)
  const [notice, setNotice] = useState<string>()
  const busy = useRef(false)

  const refresh = useCallback(async () => setState(await fetchState()), [])

  // An FSP's start link may name the FSP: /?fsp=<Directory member URL>
  useEffect(() => {
    const fsp = new URLSearchParams(window.location.search).get('fsp')
    const init = async () => {
      if (fsp) {
        const response = await fetch('/api/fsp', { method: 'POST', body: JSON.stringify({ fsp }) })
        const body = await response.json()
        setNotice(response.ok ? `Started from ${body.name}'s link.` : `FSP link not accepted: ${body.error}`)
        window.history.replaceState(null, '', '/')
      }
      await refresh()
    }
    void init()
  }, [refresh])

  const next = state ? STEPS.find((s) => state.steps[s.id]?.status !== 'done') : undefined
  const nextStatus = next && state?.steps[next.id]?.status

  const run = useCallback(
    async (id: StepId) => {
      if (busy.current) return
      busy.current = true
      setRunning(id)
      try {
        await fetch(`/api/steps/${id}`, { method: 'POST' })
      } finally {
        busy.current = false
        setRunning(undefined)
        await refresh()
      }
    },
    [refresh],
  )

  // Automatic steps run one after another; the chain stops at a failure or at
  // a step that needs the user.
  useEffect(() => {
    if (!next || paused || running || next.kind !== 'auto' || nextStatus === 'failed') return
    const timer = setTimeout(() => void run(next.id), 400)
    return () => clearTimeout(timer)
  }, [next, nextStatus, paused, running, run])

  const reset = async () => {
    await fetch('/api/reset', { method: 'POST' })
    setPaused(false)
    setNotice(undefined)
    await refresh()
  }

  if (!state) return <main>Loading…</main>

  const done = STEPS.filter((s) => state.steps[s.id]?.status === 'done').length

  return (
    <main>
      <header className="intro">
        <h1>Perseus readiness</h1>
        <p>
          We are a Carbon Accounting Provider completing the Perseus &ldquo;FSP-initiated with one permission&rdquo;
          flow in the IB1 sandbox, from our Directory listing to an emissions report for the SME&rsquo;s Financial
          Service Provider. Each step runs against live sandbox services and records the requests it made.
        </p>
        {notice && <p className="hint">{notice}</p>}
        <div className="toolbar">
          <span className="progress">
            {done} of {STEPS.length} steps complete
          </span>
          <button className="secondary" onClick={() => setPaused((p) => !p)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="secondary" onClick={reset}>
            Start again
          </button>
        </div>
      </header>

      <ol className="steps">
        {STEPS.map((definition, index) => {
          const result = state.steps[definition.id]
          const isNext = next?.id === definition.id
          return (
            <StepCard
              key={definition.id}
              number={index + 1}
              definition={definition}
              result={result}
              running={running === definition.id}
              isNext={isNext}
              state={state}
              onRetry={() => void run(definition.id)}
              onChange={refresh}
            />
          )
        })}
      </ol>

      {state.steps.report?.status === 'done' && <Report />}
    </main>
  )
}
