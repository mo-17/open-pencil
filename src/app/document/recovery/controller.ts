import { watchDebounced } from '@vueuse/core'
import { shallowRef, watch, type WatchHandle } from 'vue'

import { getRecoveryStore, isRecoveryStoreMemoryFallback } from '@/app/document/recovery/store'
import type { RecoveryStore } from '@/app/document/recovery/types'
import { createCanvasId } from '@/app/storage/id'

type RecoveryState = { documentName: string; sceneVersion?: number }

interface DocumentRecoveryOptions {
  state: RecoveryState
  version?: () => number
  buildFigFile: () => Promise<Uint8Array> | Uint8Array
  hasWritableSource: () => boolean
  isEnabled?: () => boolean
  store?: RecoveryStore
  recoveryId?: string
}

export type RecoveryStatus = Readonly<{
  phase: 'idle' | 'writing' | 'ready' | 'failed' | 'disabled'
  updatedAt: string | null
  sessionOnly: boolean
  errorCode: 'snapshot-write-failed' | 'snapshot-cleanup-failed' | null
}>

export interface DocumentRecoveryController {
  getRecoveryStatus(): RecoveryStatus
  getRecoveryId(): string
  adoptRecoverySnapshot(id: string, sceneVersion: number, updatedAt?: string): Promise<void>
  persistNow(): Promise<void>
  markProtectedVersion(version: number, resetForSource?: boolean): Promise<void>
  discardRecovery(): Promise<void>
  disposeRecovery(): void
}

export function createDocumentRecovery({
  state,
  buildFigFile,
  version: currentVersion = () => state.sceneVersion ?? 0,
  hasWritableSource,
  isEnabled = () => true,
  store = getRecoveryStore(),
  recoveryId = createCanvasId()
}: DocumentRecoveryOptions): DocumentRecoveryController {
  const status = shallowRef<RecoveryStatus>({
    phase: 'idle',
    updatedAt: null,
    sessionOnly: false,
    errorCode: null
  })
  function resetStatus(): void {
    status.value = { phase: 'idle', updatedAt: null, sessionOnly: false, errorCode: null }
  }
  function current(generation: number): boolean {
    return !disposed && generation === lifecycleGeneration
  }
  let id = recoveryId
  let protectedVersion = currentVersion()
  let persistedVersion: number | null = null
  let requestedVersion = protectedVersion
  let lifecycleGeneration = 0
  let writing: Promise<void> | null = null
  let cleanup: Promise<void> = Promise.resolve()
  let disposed = false

  async function runWrites(generation: number): Promise<void> {
    if (disposed || generation !== lifecycleGeneration || !isEnabled()) return
    if (hasWritableSource() || requestedVersion === protectedVersion) return
    const version = requestedVersion
    const snapshotId = id
    const documentName = state.documentName
    status.value = { ...status.value, phase: 'writing', errorCode: null }
    const bytes = await buildFigFile()
    if (!current(generation) || hasWritableSource() || !isEnabled()) return
    const metadata = await store.write({
      id: snapshotId,
      documentName,
      figBytes: bytes
    })
    persistedVersion = version
    if (!current(generation)) return
    status.value = {
      phase: 'ready',
      updatedAt: metadata.updatedAt,
      sessionOnly: isRecoveryStoreMemoryFallback(),
      errorCode: null
    }
    protectedVersion = version
    if (requestedVersion !== version) await runWrites(generation)
  }

  async function persistNow(): Promise<void> {
    let awaitedCleanup: Promise<void>
    do {
      awaitedCleanup = cleanup
      await awaitedCleanup
    } while (awaitedCleanup !== cleanup)
    if (disposed || hasWritableSource() || !isEnabled()) return
    requestedVersion = currentVersion()
    if (requestedVersion === protectedVersion) return
    if (!writing) {
      const generation = lifecycleGeneration
      writing = runWrites(generation)
        .catch((error: unknown) => {
          if (current(generation)) {
            status.value = { ...status.value, phase: 'failed', errorCode: 'snapshot-write-failed' }
          }
          throw error
        })
        .finally(() => {
          writing = null
        })
    }
    await writing
  }

  const stopVersionWatch: WatchHandle = watchDebounced(
    () => currentVersion(),
    () => {
      void persistNow().catch((error) => console.warn('[Recovery] Snapshot failed:', error))
    },
    { debounce: 3000, maxWait: 10000 }
  )

  const stopEnabledWatch: WatchHandle = watch(
    isEnabled,
    (enabled) => {
      if (enabled) {
        protectedVersion = currentVersion()
        requestedVersion = currentVersion()
        resetStatus()
        return
      }
      lifecycleGeneration++
      resetStatus()
      const cleanupGeneration = lifecycleGeneration
      const snapshotId = id
      requestedVersion = currentVersion()
      protectedVersion = currentVersion()
      const activeWrite = writing
      cleanup = cleanup
        .then(async () => {
          await activeWrite?.catch(() => undefined)
          await store.remove(snapshotId)
          if (cleanupGeneration === lifecycleGeneration) persistedVersion = null
          return undefined
        })
        .catch((error: unknown) => {
          if (current(cleanupGeneration)) {
            status.value = {
              ...status.value,
              phase: 'failed',
              errorCode: 'snapshot-cleanup-failed'
            }
          }
          console.warn('[Recovery] Failed to disable recovery:', error)
        })
    },
    { flush: 'sync' }
  )

  function serializeCleanup(operation: (generation: number) => Promise<void>): Promise<void> {
    const generation = ++lifecycleGeneration
    const activeWrite = writing
    const result = cleanup.then(async () => {
      await activeWrite?.catch(() => undefined)
      if (!current(generation)) return undefined
      await operation(generation)
      return undefined
    })
    // Publish the entire deletion/adoption transaction before yielding. New
    // snapshots must never race a delayed deletion of the same recovery id.
    cleanup = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  return {
    getRecoveryId: () => id,
    getRecoveryStatus: () => {
      if (!isEnabled() && status.value.phase !== 'failed')
        return { ...status.value, phase: 'disabled' }
      return status.value
    },
    adoptRecoverySnapshot(nextId, sceneVersion, updatedAt) {
      return serializeCleanup(async () => {
        const previousId = id
        id = nextId
        protectedVersion = sceneVersion
        persistedVersion = sceneVersion
        requestedVersion = sceneVersion
        status.value = {
          phase: 'ready',
          updatedAt: updatedAt ?? null,
          sessionOnly: isRecoveryStoreMemoryFallback(),
          errorCode: null
        }
        if (previousId !== nextId) await store.remove(previousId)
      })
    },
    persistNow,
    markProtectedVersion(version, resetForSource = false) {
      if (resetForSource) resetStatus()
      return serializeCleanup(async (generation) => {
        protectedVersion = version
        requestedVersion = currentVersion()
        if (persistedVersion == null || persistedVersion <= version) {
          await store.remove(id)
          if (!current(generation)) return
          persistedVersion = null
          resetStatus()
        }
      })
    },
    discardRecovery() {
      return serializeCleanup(async (generation) => {
        protectedVersion = currentVersion()
        persistedVersion = null
        requestedVersion = currentVersion()
        await store.remove(id)
        if (current(generation)) resetStatus()
      })
    },
    disposeRecovery() {
      disposed = true
      lifecycleGeneration++
      stopVersionWatch()
      stopEnabledWatch()
    }
  }
}
