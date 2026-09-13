import { computed, ref, shallowRef } from 'vue'

import type {
  ManagedPreviewConfig,
  ManagedPreviewEvent,
  ManagedPreviewState
} from '@open-pencil/compiler/managed-preview'

import type { PreparedLocalBackendPreview } from '../local-backend-connection'
import type { ManagedBackendSnapshot } from './capture'
import type { createManagedBackendPreviewHost } from './host'

type ManagedHost = ReturnType<typeof createManagedBackendPreviewHost>

export interface ManagedBackendControllerInput {
  createHost: typeof createManagedBackendPreviewHost
  capture(isCurrent: () => boolean): Promise<ManagedBackendSnapshot>
  stopFrontend(): Promise<void>
  connectFrontend(prepared: PreparedLocalBackendPreview): Promise<void>
}

export const DEFAULT_MANAGED_PREVIEW_CONFIG: ManagedPreviewConfig = Object.freeze({
  previewPort: 5181,
  apiPort: 3012,
  dbPort: 55443,
  audience: '',
  jwksURL: '',
  caFile: ''
})

/** Renderer state never grants SQL authority; confirmed plan IDs are checked again by the host. */
export function createManagedBackendPreviewController(input: ManagedBackendControllerInput) {
  const state = shallowRef<ManagedPreviewState | null>(null)
  const busy = ref(false)
  const message = ref('Prepare an isolated local backend to begin.')
  const error = ref<string | null>(null)
  const logs = ref<string[]>([])
  const config = shallowRef<ManagedPreviewConfig | null>(null)
  const enabled = ref(false)
  const wantsRunning = ref(false)
  const prepared = ref(false)
  let host: ManagedHost | null = null
  let snapshot: ManagedBackendSnapshot | null = null
  let epoch = 0
  let operation = 0
  let disposed = false
  const plan = computed(() => state.value?.plan ?? null)
  const canStart = computed(
    () =>
      prepared.value &&
      !busy.value &&
      state.value?.initialized === true &&
      !plan.value &&
      state.value.phase !== 'running'
  )

  function log(text: string) {
    logs.value = [...logs.value.slice(-199), text.slice(0, 1000)]
  }

  function onEvent(event: ManagedPreviewEvent) {
    if (disposed || event.type !== 'progress') return
    log(event.message)
    if (busy.value) message.value = event.message
  }

  function ensureHost(): ManagedHost {
    if (!host)
      host = input.createHost({
        onEvent,
        onTerminal: (text) => {
          if (disposed) return
          operation++
          busy.value = false
          wantsRunning.value = false
          message.value = text
          error.value = text
          log(text)
          clearAuthority()
          prepared.value = false
          void input.stopFrontend().catch(() => undefined)
        }
      })
    return host
  }

  function clearAuthority() {
    if (state.value)
      state.value = { ...state.value, connection: null, plan: null, phase: 'stopped' }
  }

  function currentSnapshot(): ManagedBackendSnapshot {
    if (!snapshot) throw new Error('Prepare the current document before continuing.')
    snapshot.assertCurrent()
    return snapshot
  }

  function publish(next: ManagedPreviewState) {
    const current = currentSnapshot()
    if (next.plan && next.plan.toApplicationDigest !== current.applicationDigest) {
      throw new Error('The migration review is stale. Prepare the current document again.')
    }
    if (next.connection && next.connection.applicationDigest !== current.applicationDigest) {
      throw new Error('The running backend does not match this document.')
    }
    state.value = next
    prepared.value = true
  }

  async function run(label: string, task: (current: () => boolean) => Promise<void>) {
    const serial = ++operation
    const isCurrent = () => !disposed && serial === operation
    busy.value = true
    error.value = null
    message.value = label
    log(label)
    try {
      await task(isCurrent)
    } catch (cause) {
      if (!isCurrent()) return
      clearAuthority()
      prepared.value = false
      message.value = cause instanceof Error ? cause.message : 'Managed preview failed.'
      error.value = message.value
      log(message.value)
      await Promise.allSettled([input.stopFrontend(), host?.stop()])
    } finally {
      if (isCurrent()) busy.value = false
    }
  }

  async function stopOwned() {
    clearAuthority()
    await Promise.all([input.stopFrontend(), host?.stop()])
  }

  async function startPrepared(isCurrent: () => boolean) {
    currentSnapshot()
    const next = await ensureHost().start()
    if (!isCurrent()) return
    publish(next)
    if (!next.connection) throw new Error('The managed backend did not become ready.')
    await input.connectFrontend({
      connection: next.connection,
      loginPath: currentSnapshot().loginPath
    })
    if (!isCurrent()) return
    message.value = 'Managed backend is running. Frontend edits update automatically.'
  }

  async function prepare(nextConfig: ManagedPreviewConfig, automatic = false) {
    enabled.value = true
    config.value = Object.freeze({ ...nextConfig })
    const identity = ++epoch
    snapshot = null
    prepared.value = false
    // Revoke the frontend immediately, before any asynchronous capture or compilation.
    const stopped = stopOwned()
    await run(
      automatic ? 'Planning the backend update…' : 'Preparing the isolated backend…',
      async (isCurrent) => {
        await stopped
        if (!isCurrent()) return
        const captured = await input.capture(() => !disposed && identity === epoch)
        if (!isCurrent()) return
        snapshot = captured
        const next = await ensureHost().prepare(currentSnapshot(), nextConfig)
        if (!isCurrent()) return
        publish(next)
        if (next.plan?.kind === 'blocked') {
          message.value = 'This change needs a manual migration. Existing data is preserved.'
        } else if (!next.initialized) {
          message.value =
            'Review the initial SQL, then install dependencies and initialize the preview database.'
        } else if (next.plan?.requiresApproval) {
          message.value = 'Review the SQL before applying this database change.'
        } else if (automatic && wantsRunning.value) {
          if (next.plan) {
            const applied = await ensureHost().apply(next.plan.planId)
            if (!isCurrent()) return
            publish(applied)
          }
          await startPrepared(isCurrent)
        } else {
          message.value = next.plan
            ? 'Ready to apply the backend update.'
            : 'Prepared. Start the managed backend when ready.'
        }
      }
    )
  }

  async function confirm(planId: string) {
    if (busy.value) return
    const review = plan.value
    if (!review || review.planId !== planId || review.kind === 'blocked') return
    await run(
      review.kind === 'initial'
        ? 'Installing dependencies and initializing the preview database…'
        : 'Applying the reviewed migration and rebuilding…',
      async (isCurrent) => {
        currentSnapshot()
        const next =
          review.kind === 'initial'
            ? await ensureHost().setup(planId)
            : await ensureHost().apply(planId)
        if (!isCurrent()) return
        publish(next)
        if (wantsRunning.value) await startPrepared(isCurrent)
        else message.value = 'Prepared. Start the managed backend when ready.'
      }
    )
  }

  async function start() {
    if (!canStart.value) return
    wantsRunning.value = true
    await run('Starting the managed backend…', startPrepared)
  }

  async function stop() {
    const serial = ++operation
    error.value = null
    const pendingReview = plan.value !== null
    if (pendingReview) prepared.value = false
    wantsRunning.value = false
    busy.value = false
    try {
      await stopOwned()
      if (!disposed && serial === operation)
        message.value = pendingReview
          ? 'Stopped. Prepare again to review the pending backend change. Database data is retained.'
          : 'Stopped. The preview database data is retained.'
    } catch {
      if (!disposed && serial === operation) {
        prepared.value = false
        message.value = 'Could not stop the managed backend. Close the preview to retry cleanup.'
        error.value = message.value
        log(message.value)
      }
    }
  }

  function documentChanged() {
    if (!enabled.value || !config.value) return
    void prepare(config.value, true)
  }

  async function invalidate(reason = 'Configuration changed. Prepare the backend again.') {
    error.value = null
    enabled.value = false
    epoch++
    const serial = ++operation
    snapshot = null
    prepared.value = false
    busy.value = false
    wantsRunning.value = false
    try {
      await stopOwned()
      if (!disposed && serial === operation) message.value = reason
    } catch {
      if (!disposed && serial === operation) {
        message.value = 'Could not stop the managed backend. Close the preview to retry cleanup.'
        error.value = message.value
        log(message.value)
      }
    }
  }

  async function dispose() {
    disposed = true
    epoch++
    operation++
    enabled.value = false
    await Promise.allSettled([input.stopFrontend(), host?.dispose()])
    host = null
    snapshot = null
    prepared.value = false
  }

  async function deactivate() {
    enabled.value = false
    await invalidate('Managed preview is stopped. Its database data is retained.')
  }

  return {
    state,
    busy,
    message,
    error,
    logs,
    config,
    enabled,
    wantsRunning,
    plan,
    canStart,
    prepare,
    confirm,
    start,
    stop,
    documentChanged,
    invalidate,
    deactivate,
    dispose
  }
}

export type ManagedBackendPreviewController = ReturnType<
  typeof createManagedBackendPreviewController
>
