import { describe, expect, test } from 'bun:test'

import { reactive, ref } from 'vue'

import { createDefaultEditorState } from '@open-pencil/core/editor'

import { createDocumentRecovery } from '@/app/document/recovery/controller'
import { createMemoryRecoveryStore } from '@/app/document/recovery/memory'
import type { RecoverySnapshotInput, RecoveryStore } from '@/app/document/recovery/types'

function deferredWriteStore() {
  const memory = createMemoryRecoveryStore()
  let signalStarted: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  let release: (() => void) | null = null
  const store: RecoveryStore = {
    ...memory,
    async write(input: RecoverySnapshotInput) {
      signalStarted()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return memory.write(input)
    }
  }
  return { store, started, release: () => release?.() }
}

function deferredRemoveStore() {
  const memory = createMemoryRecoveryStore()
  let signalStarted: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  let release: (() => void) | null = null
  const store: RecoveryStore = {
    ...memory,
    async remove(id: string) {
      signalStarted()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await memory.remove(id)
    }
  }
  return { store, started, release: () => release?.() }
}

function setup(
  buildFigFile = async () => new Uint8Array([1, 2, 3]),
  initialEnabled = true,
  injectedStore?: RecoveryStore
) {
  const state = reactive({ ...createDefaultEditorState('page-1'), documentName: 'Agent draft' })
  const store = injectedStore ?? createMemoryRecoveryStore()
  let writable = false
  const enabled = ref(initialEnabled)
  const recovery = createDocumentRecovery({
    state,
    store,
    recoveryId: 'recovery-1',
    hasWritableSource: () => writable,
    isEnabled: () => enabled.value,
    buildFigFile
  })
  return {
    state,
    store,
    recovery,
    setWritable: (value: boolean) => (writable = value),
    setEnabled: (value: boolean) => (enabled.value = value)
  }
}

describe('document recovery controller', () => {
  test('persists source-less changes and skips untouched documents', async () => {
    const { state, store, recovery } = setup()
    await recovery.persistNow()
    expect(await store.list()).toEqual([])

    state.sceneVersion = 1
    await recovery.persistNow()
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(1)
    recovery.disposeRecovery()
  })

  test('does not serialize or persist while disabled', async () => {
    let builds = 0
    const { state, store, recovery } = setup(async () => {
      builds++
      return new Uint8Array([1])
    }, false)
    state.sceneVersion = 1
    await recovery.persistNow()
    expect(builds).toBe(0)
    expect(await store.list()).toEqual([])
    recovery.disposeRecovery()
  })

  test('removes the owned snapshot when disabled and resumes from the current version', async () => {
    const { state, store, recovery, setEnabled } = setup()
    state.sceneVersion = 1
    await recovery.persistNow()
    expect(await store.list()).toHaveLength(1)

    setEnabled(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(await store.list()).toEqual([])

    state.sceneVersion = 2
    setEnabled(true)
    await recovery.persistNow()
    expect(await store.list()).toEqual([])

    state.sceneVersion = 3
    await recovery.persistNow()
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(3)
    recovery.disposeRecovery()
  })

  test('waits for disable cleanup before writing after re-enable', async () => {
    const deferred = deferredRemoveStore()
    const { state, store, recovery, setEnabled } = setup(undefined, true, deferred.store)
    state.sceneVersion = 1
    await recovery.persistNow()

    setEnabled(false)
    setEnabled(true)
    state.sceneVersion = 2
    const nextWrite = recovery.persistNow()
    await Promise.resolve()
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(1)

    deferred.release()
    await nextWrite
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(2)
    recovery.disposeRecovery()
  })

  test('does not persist documents with writable sources', async () => {
    const { state, store, recovery, setWritable } = setup()
    setWritable(true)
    state.sceneVersion = 1
    await recovery.persistNow()
    expect(await store.list()).toEqual([])
    recovery.disposeRecovery()
  })

  test('recovery coalesces 100 changes during encoding to the latest scene version', async () => {
    let release: (() => void) | null = null
    let calls = 0
    const { state, store, recovery } = setup(async () => {
      calls++
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return new Uint8Array([calls])
    })
    state.sceneVersion = 1
    const pending = recovery.persistNow()
    await Promise.resolve()
    for (let version = 2; version <= 101; version++) {
      state.sceneVersion = version
      void recovery.persistNow()
    }
    const releaseFirst = () => {
      if (release) release()
    }
    releaseFirst()
    await pending

    expect(calls).toBe(2)
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(101)
    recovery.disposeRecovery()
  })

  test('propagates persistence failures to close and reload callers', async () => {
    const state = reactive({ ...createDefaultEditorState('page-1'), documentName: 'Draft' })
    const store = createMemoryRecoveryStore()
    const memoryWrite = store.write.bind(store)
    let writeAttempts = 0
    store.write = async (input) => {
      writeAttempts++
      if (writeAttempts === 1) throw new Error('recovery storage unavailable')
      return memoryWrite(input)
    }
    const recovery = createDocumentRecovery({
      state,
      store,
      recoveryId: 'recovery-1',
      hasWritableSource: () => false,
      buildFigFile: () => new Uint8Array([1])
    })
    state.sceneVersion = 1

    await expect(recovery.persistNow()).rejects.toThrow('recovery storage unavailable')
    await recovery.persistNow()
    expect(writeAttempts).toBe(2)
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(1)
    recovery.disposeRecovery()
  })

  test('successful save removes recovery data', async () => {
    const { state, store, recovery } = setup()
    state.sceneVersion = 1
    await recovery.persistNow()
    expect(await store.list()).toHaveLength(1)

    await recovery.markProtectedVersion(1)
    expect(await store.list()).toEqual([])
    recovery.disposeRecovery()
  })

  test('save waits for an active write before deleting its snapshot', async () => {
    const deferred = deferredWriteStore()
    const state = reactive({ ...createDefaultEditorState('page-1'), documentName: 'Draft' })
    const recovery = createDocumentRecovery({
      state,
      store: deferred.store,
      recoveryId: 'recovery-1',
      hasWritableSource: () => false,
      buildFigFile: () => new Uint8Array([1])
    })
    state.sceneVersion = 1
    const write = recovery.persistNow()
    await Promise.resolve()
    const cleanup = recovery.markProtectedVersion(1)
    deferred.release()
    await Promise.all([write, cleanup])

    expect(await deferred.store.list()).toEqual([])
    recovery.disposeRecovery()
  })

  test('discard waits for an active write before deleting its snapshot', async () => {
    const deferred = deferredWriteStore()
    const state = reactive({ ...createDefaultEditorState('page-1'), documentName: 'Draft' })
    const recovery = createDocumentRecovery({
      state,
      store: deferred.store,
      recoveryId: 'recovery-1',
      hasWritableSource: () => false,
      buildFigFile: () => new Uint8Array([1])
    })
    state.sceneVersion = 1
    const write = recovery.persistNow()
    await Promise.resolve()
    const discard = recovery.discardRecovery()
    deferred.release()
    await Promise.all([write, discard])

    expect(await deferred.store.list()).toEqual([])
    recovery.disposeRecovery()
  })

  test('adoption waits for an active write and removes the previous recovery id', async () => {
    const deferred = deferredWriteStore()
    const state = reactive({ ...createDefaultEditorState('page-1'), documentName: 'Draft' })
    const recovery = createDocumentRecovery({
      state,
      store: deferred.store,
      recoveryId: 'previous',
      hasWritableSource: () => false,
      buildFigFile: () => new Uint8Array([1])
    })
    state.sceneVersion = 1
    const write = recovery.persistNow()
    await Promise.resolve()
    const adoption = recovery.adoptRecoverySnapshot('recovered', 7)
    deferred.release()
    await Promise.all([write, adoption])

    expect(recovery.getRecoveryId()).toBe('recovered')
    expect(await deferred.store.read('previous')).toBeNull()
    recovery.disposeRecovery()
  })

  test('preserves a snapshot newer than the saved version', async () => {
    const { state, store, recovery } = setup()
    state.sceneVersion = 2
    await recovery.persistNow()

    await recovery.markProtectedVersion(1)

    expect((await store.read('recovery-1'))?.sceneVersion).toBe(2)
    recovery.disposeRecovery()
  })
})

describe('recovery status and lifecycle', () => {
  test('retains the last snapshot timestamp on failure and exposes a successful retry', async () => {
    const memory = createMemoryRecoveryStore()
    let fail = false
    const store: RecoveryStore = {
      ...memory,
      write: (input) => (fail ? Promise.reject(new Error('quota exceeded')) : memory.write(input))
    }
    const { state, recovery } = setup(undefined, true, store)
    expect(recovery.getRecoveryStatus().updatedAt).toBeNull()
    state.sceneVersion = 1
    await recovery.persistNow()
    const saved = recovery.getRecoveryStatus()
    expect(saved.phase).toBe('ready')
    expect(saved.updatedAt).toBe((await store.read('recovery-1'))?.updatedAt ?? null)
    fail = true
    state.sceneVersion = 2
    await expect(recovery.persistNow()).rejects.toThrow('quota exceeded')
    expect(recovery.getRecoveryStatus()).toMatchObject({
      phase: 'failed',
      errorCode: 'snapshot-write-failed',
      updatedAt: saved.updatedAt
    })
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(1)
    fail = false
    await recovery.persistNow()
    expect(recovery.getRecoveryStatus()).toMatchObject({ phase: 'ready', errorCode: null })
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(2)
    recovery.disposeRecovery()
  })

  test('shows pending state and ignores a late result after restoring another snapshot', async () => {
    const deferred = deferredWriteStore()
    const { state, recovery } = setup(undefined, true, deferred.store)
    state.sceneVersion = 1
    const pending = recovery.persistNow()
    await Promise.resolve()
    expect(recovery.getRecoveryStatus().phase).toBe('writing')
    const restoredTime = '2026-09-20T12:34:00.000Z'
    const restoring = recovery.adoptRecoverySnapshot('restored', 8, restoredTime)
    deferred.release()
    await Promise.all([pending, restoring])
    expect(recovery.getRecoveryStatus()).toMatchObject({ phase: 'ready', updatedAt: restoredTime })
    expect(recovery.getRecoveryId()).toBe('restored')
    expect(await deferred.store.read('recovery-1')).toBeNull()
    recovery.disposeRecovery()
  })

  test('a failed old write does not block adopting a recovered document', async () => {
    let rejectWrite: (error: Error) => void = () => undefined
    const memory = createMemoryRecoveryStore()
    const store: RecoveryStore = {
      ...memory,
      write: () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject
        })
    }
    const { state, recovery } = setup(undefined, true, store)
    state.sceneVersion = 1
    const pending = recovery.persistNow()
    const failure = pending.catch((error: unknown) => error)
    await Promise.resolve()
    await Promise.resolve()
    const restoring = recovery.adoptRecoverySnapshot('restored', 8, '2026-09-20T12:34:00.000Z')
    rejectWrite(new Error('old write failed'))
    const [error] = await Promise.all([failure, restoring])
    expect(error).toBeInstanceOf(Error)
    expect(recovery.getRecoveryStatus()).toMatchObject({ phase: 'ready', errorCode: null })
    expect(recovery.getRecoveryId()).toBe('restored')
    recovery.disposeRecovery()
  })

  test('closing during adoption cannot resurrect the old controller or update the reopened document', async () => {
    const deferred = deferredWriteStore()
    const old = setup(undefined, true, deferred.store)
    old.state.sceneVersion = 1
    const pending = old.recovery.persistNow()
    await deferred.started
    const adopting = old.recovery.adoptRecoverySnapshot('restored', 8)
    old.recovery.disposeRecovery()
    const reopened = setup()
    const previousStatus = reopened.recovery.getRecoveryStatus()
    deferred.release()
    await Promise.all([pending, adopting])
    expect(old.recovery.getRecoveryId()).toBe('recovery-1')
    expect(reopened.recovery.getRecoveryStatus()).toEqual(previousStatus)
    await old.recovery.persistNow()
    expect((await old.store.read('recovery-1'))?.sceneVersion).toBe(1)
    reopened.recovery.disposeRecovery()
  })
  test('disabled recovery cleanup can be retried without re-enabling snapshots', async () => {
    const memory = createMemoryRecoveryStore()
    let failRemoval = true
    const store: RecoveryStore = {
      ...memory,
      remove: (id) =>
        failRemoval ? Promise.reject(new Error('storage locked')) : memory.remove(id)
    }
    const { state, recovery, setEnabled } = setup(undefined, true, store)
    state.sceneVersion = 1
    await recovery.persistNow()
    setEnabled(false)
    // persistNow waits for the pending disable cleanup before observing disabled state.
    await recovery.persistNow()
    expect(recovery.getRecoveryStatus()).toMatchObject({
      phase: 'failed',
      errorCode: 'snapshot-cleanup-failed'
    })
    expect(await memory.list()).toHaveLength(1)
    failRemoval = false
    await recovery.discardRecovery()
    expect(recovery.getRecoveryStatus()).toMatchObject({ phase: 'disabled', errorCode: null })
    state.sceneVersion = 2
    await recovery.persistNow()
    expect(await memory.list()).toEqual([])
    recovery.disposeRecovery()
  })
  test('replacing a document hides its previous snapshot status before asynchronous cleanup settles', async () => {
    const deferred = deferredRemoveStore()
    const { state, recovery } = setup(undefined, true, deferred.store)
    state.sceneVersion = 1
    await recovery.persistNow()
    expect(recovery.getRecoveryStatus().phase).toBe('ready')
    state.sceneVersion = 2
    const replacement = recovery.markProtectedVersion(2, true)
    expect(recovery.getRecoveryStatus()).toMatchObject({ phase: 'idle', updatedAt: null })
    await deferred.started
    deferred.release()
    await replacement
    expect(recovery.getRecoveryStatus()).toMatchObject({ phase: 'idle', updatedAt: null })
    recovery.disposeRecovery()
  })
  test('a delayed save cleanup cannot remove a newer recovery snapshot', async () => {
    const deferred = deferredRemoveStore()
    const { state, recovery, store } = setup(undefined, true, deferred.store)
    state.sceneVersion = 1
    await recovery.persistNow()
    const cleanup = recovery.markProtectedVersion(1)
    await deferred.started
    state.sceneVersion = 2
    const newerWrite = recovery.persistNow()
    await Promise.resolve()
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(1)
    deferred.release()
    await Promise.all([cleanup, newerWrite])
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(2)
    expect(recovery.getRecoveryStatus().phase).toBe('ready')
    await recovery.persistNow()
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(2)
    recovery.disposeRecovery()
  })
  test('a pending persistence request follows a cleanup barrier published before it resumes', async () => {
    const deferred = deferredRemoveStore()
    const { state, recovery, store } = setup(undefined, true, deferred.store)
    state.sceneVersion = 1
    await recovery.persistNow()
    state.sceneVersion = 2
    const newerWrite = recovery.persistNow()
    const cleanup = recovery.markProtectedVersion(1)
    await deferred.started
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(1)
    deferred.release()
    await Promise.all([cleanup, newerWrite])
    expect((await store.read('recovery-1'))?.sceneVersion).toBe(2)
    expect(recovery.getRecoveryStatus().phase).toBe('ready')
    recovery.disposeRecovery()
  })
})
