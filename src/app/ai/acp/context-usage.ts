import { useNow } from '@vueuse/core'
import { computed } from 'vue'

import { acpDiagnostics } from './diagnostics'
import type { ACPDiagnosticsSnapshot } from './diagnostics'

/** Context reports are snapshots, not a live measurement of the agent's prompt. */
export const ACP_USAGE_MAX_AGE_MS = 5 * 60 * 1_000

export interface ACPContextUsageView {
  state: 'unavailable' | 'invalid' | 'stale' | 'available'
  used?: number
  capacity?: number
  percent?: number
  updatedAt?: number
  inputTokens?: number
  outputTokens?: number
}

export function acpContextUsageView(
  snapshot: Readonly<ACPDiagnosticsSnapshot>,
  sessionId: string | null,
  now: number
): ACPContextUsageView {
  if (!sessionId || !snapshot.active || snapshot.sessionId !== sessionId) {
    return { state: 'unavailable' }
  }
  const view: ACPContextUsageView = { state: snapshot.contextInvalid ? 'invalid' : 'unavailable' }
  if (snapshot.usage && isFresh(snapshot.usageUpdatedAt, now)) {
    view.inputTokens = snapshot.usage.inputTokens
    view.outputTokens = snapshot.usage.outputTokens
  }
  if (!snapshot.context || snapshot.contextUpdatedAt === undefined) return view
  if (!isFresh(snapshot.contextUpdatedAt, now)) return { ...view, state: 'stale' }
  return {
    ...view,
    state: 'available',
    used: snapshot.context.used,
    capacity: snapshot.context.size,
    percent: (snapshot.context.used / snapshot.context.size) * 100,
    updatedAt: snapshot.contextUpdatedAt
  }
}

function isFresh(timestamp: number | undefined, now: number): boolean {
  return timestamp !== undefined && timestamp <= now && now - timestamp < ACP_USAGE_MAX_AGE_MS
}

export function useACPContextUsage(sessionId: () => string | null) {
  const now = useNow({ interval: 30_000 })
  return computed(() =>
    acpContextUsageView(
      acpDiagnostics.value,
      sessionId(),
      Math.max(now.value.getTime(), Date.now())
    )
  )
}
