/** Explicit browser recovery is isolated from ordinary memory-only command attempts. */
export const COMMAND_RECOVERY_RUNTIME_SOURCE = String.raw`
export interface BackendCommandRecoverySnapshot extends Record<string, unknown> {
  status: 'empty' | 'recorded' | 'incompatible'
  key?: string
  payload?: Record<string, string | number | boolean>
  createdAt?: number
}
export interface BackendCommandRecoveryInput {
  commandId: keyof BackendCommandResults
  idempotencyKeyTarget: StateName
  operation: 'inspect' | 'retry' | 'acknowledge'
  attemptKey?: string
}
type RecoveryData<I extends BackendCommandRecoveryInput> = I['operation'] extends 'retry' ? BackendCommandResults[I['commandId']] : BackendCommandRecoverySnapshot
type CommandSession = ReturnType<typeof getSession>
const durableCommands = new Map<string, { key: string; payload: string; running: Promise<BackendResult<unknown>> }>()

function commandSlot(commandId: keyof BackendCommandResults, target: StateName, session: CommandSession): string {
  if (!session.ready || !session.signedIn || !session.id) throw new BackendCommandError(401)
  if (!Object.hasOwn(commandParameters, commandId) || typeof target !== 'string' || !target || target.length > 256) throw new BackendCommandError(400)
  if (typeof location === 'undefined' || !location.origin || location.origin === 'null') throw new BackendCommandError(503)
  return JSON.stringify([location.origin, commandRecoveryBinding, session.id, commandId, target])
}

function journalPayload(record: CommandJournalRecord, commandId: keyof BackendCommandResults): Record<string, string | number | boolean> {
  if (record.definition !== commandDefinitions[commandId]) throw new BackendCommandError(409)
  try {
    const payload = normalizeCommandParameters(JSON.parse(record.payload), commandParameters[commandId])
    if (JSON.stringify(payload) !== record.payload) throw new BackendCommandError(503)
    return payload
  } catch { throw new BackendCommandError(503) }
}

async function durableBackendCommand(input: BackendCommandInput, payload: object, canonical: string, session: CommandSession): Promise<BackendResult<unknown>> {
  const slot = commandSlot(input.commandId, input.idempotencyKeyTarget, session)
  let key = readBackendState(input.idempotencyKeyTarget)
  const fresh = key === ''
  if (fresh) key = crypto.randomUUID()
  if (!validCommandKey(key)) throw new BackendCommandError(400)
  const idempotencyKey = key
  const previous = durableCommands.get(slot)
  if (previous) {
    if (previous.key !== key || previous.payload !== canonical) throw new BackendCommandError(409)
    return await previous.running
  }
  if (durableCommands.size >= 128) throw new BackendCommandError(503)
  setBackendState(session.generation, input.idempotencyKeyTarget, key as StateValue, '' as StateValue)
  const controller = new AbortController()
  requests.add(controller)
  const current = () => !controller.signal.aborted && getSession().generation === session.generation && getSession().signedIn
  let recorded = false
  const running = withCommandJournalLock(slot, async (): Promise<BackendResult<unknown>> => {
    if (!current()) return { current: false }
    const record = await readCommandJournal(slot, controller.signal)
    if (!current()) return { current: false }
    if (record) {
      if (record.key !== idempotencyKey || record.definition !== commandDefinitions[input.commandId] || record.payload !== canonical) throw new BackendCommandError(409)
      journalPayload(record, input.commandId)
      recorded = true
    } else {
      // A stale tab may not resurrect a key which another tab already acknowledged.
      if (!fresh) throw new BackendCommandError(409)
      await createCommandJournal({ version: 1, slot, definition: commandDefinitions[input.commandId], key: idempotencyKey, payload: canonical, createdAt: Date.now() }, controller.signal)
      recorded = true
    }
    if (!current()) return { current: false }
    return await executeCommand(input.commandId, payload, idempotencyKey, controller, session.generation)
  }).catch((error: unknown): BackendResult<unknown> => {
    if (!current()) return { current: false }
    // No dispatch occurred. A raced/failed initial claim must not strand this page's new key.
    // If an uncertain storage completion did persist, the next claim still sees that row and blocks.
    if (fresh && !recorded && readBackendState(input.idempotencyKeyTarget) === idempotencyKey)
      setBackendState(session.generation, input.idempotencyKeyTarget, '' as StateValue, '' as StateValue)
    throw commandError(error)
  }).finally(() => { requests.delete(controller) })
  durableCommands.set(slot, { key: idempotencyKey, payload: canonical, running })
  try { const result = await running; return current() ? result : { current: false } }
  finally { if (durableCommands.get(slot)?.running === running) durableCommands.delete(slot) }
}

export async function backendCommandRecovery<I extends BackendCommandRecoveryInput>(input: I): Promise<BackendResult<RecoveryData<I>>> {
  const session = getSession()
  const slot = commandSlot(input.commandId, input.idempotencyKeyTarget, session)
  const attemptKey = input.attemptKey
  if (!['inspect', 'retry', 'acknowledge'].includes(input.operation) ||
    (input.operation === 'inspect' ? attemptKey !== undefined : !validCommandKey(attemptKey))) throw new BackendCommandError(400)
  const controller = new AbortController()
  requests.add(controller)
  const current = () => !controller.signal.aborted && getSession().generation === session.generation && getSession().signedIn
  const operation = async (): Promise<BackendResult<unknown>> => {
    if (!current()) return { current: false }
    const record = await readCommandJournal(slot, controller.signal)
    if (!current()) return { current: false }
    if (input.operation === 'inspect') {
      const data: BackendCommandRecoverySnapshot = !record ? { status: 'empty' } :
        record.definition === commandDefinitions[input.commandId]
          ? { status: 'recorded', key: record.key, payload: journalPayload(record, input.commandId), createdAt: record.createdAt }
          : { status: 'incompatible', key: record.key, createdAt: record.createdAt }
      return { current: true, data, cursor: '' }
    }
    if (!record || !validCommandKey(attemptKey) || record.key !== attemptKey) throw new BackendCommandError(409)
    if (input.operation === 'acknowledge') {
      await acknowledgeCommandJournal(slot, attemptKey, record.definition, controller.signal)
      if (!current()) return { current: false }
      // Do not erase an independently edited key while this asynchronous acknowledgement ran.
      const key = readBackendState(input.idempotencyKeyTarget)
      if (key === record.key || key === '') setBackendState(session.generation, input.idempotencyKeyTarget, '' as StateValue, '' as StateValue)
      return { current: true, data: { status: 'empty' }, cursor: '' }
    }
    const payload = journalPayload(record, input.commandId)
    setBackendState(session.generation, input.idempotencyKeyTarget, record.key as StateValue, '' as StateValue)
    if (!current()) return { current: false }
    return await executeCommand(input.commandId, payload, record.key, controller, session.generation)
  }
  try {
    const result = input.operation === 'inspect' ? await operation() : await withCommandJournalLock(slot, operation)
    if (!current()) return { current: false }
    return result as BackendResult<RecoveryData<I>>
  } catch (error) {
    if (!current()) return { current: false }
    throw commandError(error)
  } finally { requests.delete(controller) }
}
`
