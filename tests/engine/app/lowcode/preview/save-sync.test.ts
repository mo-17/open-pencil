import { expect, mock, test } from 'bun:test'

import { effectScope, nextTick, shallowRef, type WatchStopHandle } from 'vue'

import type { DocumentSaveStatus } from '@/app/document/io/save'
import { watchPreviewSaveSync } from '@/app/lowcode/preview-pane/save-sync'

const TIMESTAMP = '2026-10-01T12:00:00.000Z'

function saved(destination: DocumentSaveStatus['destination'] = 'file'): DocumentSaveStatus {
  return { phase: 'saved', destination, updatedAt: TIMESTAMP }
}

function observe(
  initial: DocumentSaveStatus = { phase: 'idle', destination: 'file', updatedAt: null }
) {
  const status = shallowRef(initial),
    scope = effectScope(),
    onSaved = mock(() => undefined)
  let stop: WatchStopHandle | undefined
  scope.run(() => {
    stop = watchPreviewSaveSync(() => status.value, onSaved)
  })
  return { status, scope, onSaved, stop: () => stop?.() }
}

test('opening preview on an already saved document does not request a save sync', async () => {
  const initial = saved(),
    observer = observe(initial)
  try {
    await nextTick()
    observer.status.value = initial
    await nextTick()
    expect(observer.onSaved).not.toHaveBeenCalled()
  } finally {
    observer.scope.stop()
  }
})

test('saving to a fresh saved object requests one sync and duplicate identity does not repeat', async () => {
  const observer = observe()
  try {
    observer.status.value = { ...observer.status.value, phase: 'saving' }
    await nextTick()
    expect(observer.onSaved).not.toHaveBeenCalled()
    const success = saved()
    observer.status.value = success
    await nextTick()
    expect(observer.onSaved).toHaveBeenCalledTimes(1)
    observer.status.value = success
    await nextTick()
    expect(observer.onSaved).toHaveBeenCalledTimes(1)
  } finally {
    observer.scope.stop()
  }
})

test('distinct successful saves in the same millisecond each request a sync', async () => {
  const first = saved(),
    second = saved(),
    observer = observe()
  try {
    expect(first.updatedAt).toBe(second.updatedAt)
    expect(first).not.toBe(second)
    observer.status.value = first
    await nextTick()
    observer.status.value = { ...first, phase: 'saving' }
    await nextTick()
    observer.status.value = second
    await nextTick()
    expect(observer.onSaved).toHaveBeenCalledTimes(2)
  } finally {
    observer.scope.stop()
  }
})

test('cancelled saves restoring any previously seen saved object never request another sync', async () => {
  const initial = saved(),
    next = saved('local-cache'),
    latest = saved('download'),
    observer = observe(initial)
  try {
    for (const success of [next, latest]) {
      observer.status.value = success
      await nextTick()
    }
    expect(observer.onSaved).toHaveBeenCalledTimes(2)
    for (const previous of [initial, next, latest, initial, latest]) {
      observer.status.value = { ...observer.status.value, phase: 'saving' }
      await nextTick()
      observer.status.value = previous
      await nextTick()
      expect(observer.onSaved).toHaveBeenCalledTimes(2)
    }
  } finally {
    observer.scope.stop()
  }
})

test('failed saves and restoration of the previous saved identity do not request a sync', async () => {
  const previous = saved(),
    observer = observe(previous)
  try {
    observer.status.value = { ...previous, phase: 'saving' }
    await nextTick()
    observer.status.value = { ...previous, phase: 'failed' }
    await nextTick()
    expect(observer.onSaved).not.toHaveBeenCalled()
    observer.status.value = previous
    await nextTick()
    expect(observer.onSaved).not.toHaveBeenCalled()
    observer.status.value = saved()
    await nextTick()
    expect(observer.onSaved).toHaveBeenCalledTimes(1)
  } finally {
    observer.scope.stop()
  }
})

test('saveAs completion at a new destination requests sync for the fresh status', async () => {
  const previous = saved('local-cache'),
    observer = observe(previous)
  try {
    observer.status.value = { ...previous, phase: 'saving' }
    await nextTick()
    // createSaveActions saveAs changes the source revision before publishing a fresh saved status.
    observer.status.value = { phase: 'idle', destination: 'file', updatedAt: null }
    await nextTick()
    observer.status.value = saved('file')
    await nextTick()
    expect(observer.onSaved).toHaveBeenCalledTimes(1)
  } finally {
    observer.scope.stop()
  }
})

test('Vue batching of saving and fresh saved in the same tick still requests one sync', async () => {
  const observer = observe()
  try {
    observer.status.value = { ...observer.status.value, phase: 'saving' }
    observer.status.value = saved()
    expect(observer.onSaved).not.toHaveBeenCalled()
    await nextTick()
    expect(observer.onSaved).toHaveBeenCalledTimes(1)
  } finally {
    observer.scope.stop()
  }
})

test('stopping the effect scope suppresses queued and future save callbacks', async () => {
  const observer = observe()
  observer.status.value = saved()
  observer.scope.stop()
  await nextTick()
  observer.status.value = saved('download')
  await nextTick()
  expect(observer.onSaved).not.toHaveBeenCalled()
})

test('the returned stop handle suppresses queued and future save callbacks', async () => {
  const observer = observe()
  try {
    observer.status.value = saved()
    observer.stop()
    await nextTick()
    observer.status.value = saved('local-cache')
    await nextTick()
    expect(observer.onSaved).not.toHaveBeenCalled()
  } finally {
    observer.scope.stop()
  }
})
