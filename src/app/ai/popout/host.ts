import {
  parseAIPopoutIntent,
  parseAIPopoutProjection,
  type AIPopoutIntent,
  type AIPopoutIntentErrorCode,
  type AIPopoutIntentResult,
  type AIPopoutProjection
} from '@/app/ai/popout/protocol'

export type AIPopoutHost = Readonly<{
  getProjection: () => AIPopoutProjection
  handleIntent: (intent: AIPopoutIntent) => Promise<void>
  subscribe: (listener: () => void) => () => void
}>

export class AIPopoutHostIntentError extends Error {
  constructor(
    readonly code: Extract<AIPopoutIntentErrorCode, 'stale-context' | 'unsupported' | 'failed'>,
    message: string
  ) {
    super(message)
    this.name = 'AIPopoutHostIntentError'
  }
}

type RegisteredHost = Readonly<{
  generation: number
  host: AIPopoutHost
  unsubscribe: () => void
}>

type ActionEntry = {
  fingerprint: string
  promise: Promise<void>
  settled: boolean
}

const MAX_ACTION_ENTRIES = 256
const subscribers = new Set<(projection: AIPopoutProjection | null) => void>()
const actions = new Map<string, ActionEntry>()
let generation = 0
let registered: RegisteredHost | null = null
let notificationQueued = false

function safeProjection(): AIPopoutProjection | null {
  if (!registered) return null
  try {
    return parseAIPopoutProjection(registered.host.getProjection())
  } catch (error) {
    console.warn('[AI popout] Host returned an invalid projection:', error)
    return null
  }
}

function notifySubscribers(): void {
  notificationQueued = false
  const projection = safeProjection()
  for (const subscriber of subscribers) {
    try {
      subscriber(projection)
    } catch (error) {
      console.warn('[AI popout] Projection subscriber failed:', error)
    }
  }
}

function scheduleNotification(): void {
  if (notificationQueued) return
  notificationQueued = true
  queueMicrotask(notifySubscribers)
}

function pruneActions(): boolean {
  if (actions.size < MAX_ACTION_ENTRIES) return true
  for (const [key, entry] of actions) {
    if (!entry.settled) continue
    actions.delete(key)
    if (actions.size < MAX_ACTION_ENTRIES) return true
  }
  return false
}

function failure(
  code: AIPopoutIntentErrorCode,
  message: string,
  projection = safeProjection()
): AIPopoutIntentResult {
  return { ok: false, code, message: message.slice(0, 2_048), projection }
}

function intentFailure(error: unknown): AIPopoutIntentResult {
  if (error instanceof AIPopoutHostIntentError) {
    return failure(error.code, error.message)
  }
  console.warn('[AI popout] Host intent failed:', error)
  return failure('failed', 'The AI action failed in the editor.')
}

export function registerAIPopoutHost(host: AIPopoutHost): () => void {
  const hostGeneration = ++generation
  registered?.unsubscribe()
  actions.clear()
  const unsubscribe = host.subscribe(scheduleNotification)
  registered = { generation: hostGeneration, host, unsubscribe }
  scheduleNotification()

  return () => {
    if (registered?.generation !== hostGeneration) return
    registered.unsubscribe()
    registered = null
    actions.clear()
    scheduleNotification()
  }
}

export { safeProjection as getAIPopoutProjection }

export function subscribeAIPopoutHost(
  listener: (projection: AIPopoutProjection | null) => void
): () => void {
  subscribers.add(listener)
  listener(safeProjection())
  return () => subscribers.delete(listener)
}

export async function handleAIPopoutIntent(value: unknown): Promise<AIPopoutIntentResult> {
  let intent: AIPopoutIntent
  try {
    intent = parseAIPopoutIntent(value)
  } catch (error) {
    return failure('invalid', error instanceof Error ? error.message : 'Invalid AI action.', null)
  }

  // A detached window does not receive raw tool input, ACP permission options, or
  // session authority. Keep the legacy wire shape parseable, but never dispatch it.
  if (intent.type === 'toolApproval') {
    return failure('unsupported', 'Tool approvals must be reviewed in the editor.')
  }

  const activeHost = registered?.host
  if (!activeHost) return failure('unavailable', 'The editor AI host is unavailable.', null)

  const actionKey = `${intent.contextId}\0${intent.clientActionId}`
  const fingerprint = JSON.stringify(intent)
  const existing = actions.get(actionKey)
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return failure('invalid', 'The AI action ID was already used for a different action.')
    }
    try {
      await existing.promise
      const projection = safeProjection()
      return projection
        ? { ok: true, duplicate: true, projection }
        : failure('unavailable', 'The editor AI host is unavailable.', null)
    } catch (error) {
      return intentFailure(error)
    }
  }

  const projection = safeProjection()
  if (!projection) return failure('unavailable', 'The editor AI host is unavailable.', null)
  if (projection.contextId !== intent.contextId) {
    return failure('stale-context', 'The active document or AI configuration changed.', projection)
  }
  if (!pruneActions()) {
    return failure('failed', 'Too many AI actions are still pending.', projection)
  }

  const entry: ActionEntry = {
    fingerprint,
    promise: Promise.resolve(),
    settled: false
  }
  entry.promise = Promise.resolve()
    .then(() => activeHost.handleIntent(intent))
    .finally(() => {
      entry.settled = true
      scheduleNotification()
    })
  actions.set(actionKey, entry)

  try {
    await entry.promise
    const latest = safeProjection()
    return latest
      ? { ok: true, duplicate: false, projection: latest }
      : failure('unavailable', 'The editor AI host is unavailable.', null)
  } catch (error) {
    return intentFailure(error)
  }
}
