import type { StepResult } from '@/lib/session'
import type { StepId } from '@/lib/steps'

export interface ClientState {
  steps: Partial<Record<StepId, StepResult>>
  user?: { name: string; id: string }
  names?: { cap: string; edp: string; fsp: string }
  fspMemberUrl: string
}
