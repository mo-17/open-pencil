import {
  parseManagedPreviewConfig,
  type ManagedPreviewCommand,
  type ManagedPreviewConfig,
  type ManagedPreviewState
} from '@open-pencil/compiler/managed-preview'

import { isTauri } from '@/app/tauri/env'

import type { ManagedBackendSnapshot } from './capture'
import {
  startManagedPreviewProcess,
  type ManagedPreviewProcess,
  type ManagedPreviewProcessCallbacks
} from './process'
import { resolveManagedPreviewSession } from './session'

export interface ManagedBackendPreviewHostDependencies {
  isDesktop(): boolean
  resolveSession(applicationId: string): string
  startProcess: typeof startManagedPreviewProcess
  requestId(): string
}

interface ManagedHostSession {
  readonly id: string
  readonly starting: Promise<ManagedPreviewProcess>
  process: ManagedPreviewProcess | null
}

const CANCELLED = 'Managed preview changed while this operation was running. Prepare it again.'

/** Desktop authority stays local: only a reviewed snapshot and public settings cross the pipe. */
export function createManagedBackendPreviewHost(
  callbacks: ManagedPreviewProcessCallbacks = {},
  dependencies: Partial<ManagedBackendPreviewHostDependencies> = {}
) {
  const env: ManagedBackendPreviewHostDependencies = {
    isDesktop: isTauri,
    resolveSession: resolveManagedPreviewSession,
    startProcess: startManagedPreviewProcess,
    requestId: () => crypto.randomUUID(),
    ...dependencies
  }
  let session: ManagedHostSession | null = null
  let snapshot: ManagedBackendSnapshot | null = null
  let config: ManagedPreviewConfig | null = null
  let state: ManagedPreviewState | null = null
  let serial = 0
  let disposed = false

  function assertAvailable() {
    if (!env.isDesktop()) throw new Error('Managed NestJS preview requires the desktop editor.')
    if (disposed) throw new Error('Managed preview has been disposed.')
  }

  function assertCurrent(operation: number, expected: ManagedBackendSnapshot) {
    assertAvailable()
    if (operation !== serial || snapshot !== expected) throw new Error(CANCELLED)
    expected.assertCurrent()
  }

  async function closeSession(current: ManagedHostSession) {
    const process = await current.starting.catch(() => null)
    await process?.close()
  }

  function launch(id: string): ManagedHostSession {
    const current: ManagedHostSession = {
      id,
      process: null,
      starting: Promise.resolve().then(async () => {
        const process = await env.startProcess(id, {
          onEvent(event) {
            if (!disposed && session === current) callbacks.onEvent?.(event)
          },
          onTerminal(message) {
            if (session !== current || disposed) return
            serial += 1
            state = null
            session = null
            void closeSession(current).catch(() => undefined)
            callbacks.onTerminal?.(message)
          }
        })
        current.process = process
        if (disposed || session !== current) {
          await process.close()
          throw new Error(CANCELLED)
        }
        return process
      })
    }
    void current.starting.catch(() => undefined)
    return current
  }

  async function getProcess(id: string, operation: number, expected: ManagedBackendSnapshot) {
    if (session && session.id !== id) {
      const previous = session
      session = null
      await closeSession(previous)
      assertCurrent(operation, expected)
    }
    if (!session) session = launch(id)
    const current = session
    const process = await current.starting
    assertCurrent(operation, expected)
    return { current, process }
  }

  function accept(
    next: ManagedPreviewState,
    current: ManagedHostSession,
    expected: ManagedBackendSnapshot
  ) {
    if (
      next.sessionId !== current.id ||
      (next.applicationId !== null && next.applicationId !== expected.application.applicationId)
    ) {
      throw new Error('Managed preview returned a different application or session.')
    }
    if (next.plan && next.plan.toApplicationDigest !== expected.applicationDigest) {
      throw new Error('Managed preview returned an outdated migration plan.')
    }
    const connection = next.connection
    if (
      connection &&
      (next.phase !== 'running' ||
        !config ||
        connection.applicationId !== expected.application.applicationId ||
        connection.applicationDigest !== expected.applicationDigest ||
        next.applicationDigest !== expected.applicationDigest ||
        connection.previewPort !== config.previewPort ||
        connection.apiPort !== config.apiPort ||
        connection.apiBasePath !== expected.application.httpApi?.browserClient?.apiBasePath)
    ) {
      throw new Error('Managed preview returned a different Backend connection.')
    }
    state = next
    return next
  }

  async function prepare(next: ManagedBackendSnapshot, publicConfig: ManagedPreviewConfig) {
    assertAvailable()
    next.assertCurrent()
    const nextConfig = parseManagedPreviewConfig(publicConfig)
    const id = env.resolveSession(next.application.applicationId)
    const operation = ++serial
    snapshot = next
    config = nextConfig
    state = null
    session?.process?.cancelPending()
    const { current, process } = await getProcess(id, operation, next)
    // Stop is a priority command; it aborts any older install or migration before preparing again.
    await process.request({ version: 1, id: env.requestId(), command: 'stop' })
    assertCurrent(operation, next)
    const result = await process.request({
      version: 1,
      id: env.requestId(),
      command: 'prepare',
      application: next.application,
      config: nextConfig
    })
    assertCurrent(operation, next)
    return accept(result, current, next)
  }

  async function run(command: 'setup' | 'apply' | 'start', planId?: string) {
    assertAvailable()
    const expected = snapshot
    const current = session
    if (!expected || !current || !state)
      throw new Error('Prepare the current managed Backend first.')
    expected.assertCurrent()
    if (
      command !== 'start' &&
      (!planId ||
        state.plan?.planId !== planId ||
        state.plan.kind === 'blocked' ||
        (command === 'setup') !== (state.plan.kind === 'initial'))
    ) {
      throw new Error('The displayed migration plan is no longer current. Prepare it again.')
    }
    const operation = ++serial
    const process = await current.starting
    assertCurrent(operation, expected)
    const input: ManagedPreviewCommand =
      command === 'start'
        ? { version: 1, id: env.requestId(), command }
        : { version: 1, id: env.requestId(), command, planId: planId ?? '' }
    const result = await process.request(input)
    assertCurrent(operation, expected)
    return accept(result, current, expected)
  }

  async function stop(): Promise<ManagedPreviewState | null> {
    const operation = ++serial
    const current = session
    if (!current) return null
    current.process?.cancelPending()
    const process = await current.starting.catch(() => null)
    if (!process || session !== current || disposed || serial !== operation) return null
    const stopped = await process.request({ version: 1, id: env.requestId(), command: 'stop' })
    if (serial !== operation || session !== current) return null
    state = stopped
    return state
  }

  return {
    prepare,
    setup: (planId: string) => run('setup', planId),
    apply: (planId: string) => run('apply', planId),
    start: () => run('start'),
    stop,
    async status(): Promise<ManagedPreviewState | null> {
      assertAvailable()
      if (!session) return null
      return (await session.starting).request({
        version: 1,
        id: env.requestId(),
        command: 'status'
      })
    },
    async dispose() {
      if (disposed) return
      disposed = true
      ++serial
      const current = session
      session = null
      snapshot = null
      state = null
      current?.process?.cancelPending()
      if (current) await closeSession(current)
    }
  }
}
