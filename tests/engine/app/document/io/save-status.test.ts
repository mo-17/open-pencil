import { describe, expect, test } from 'bun:test'

import { createDefaultEditorState } from '@open-pencil/core/editor'

import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'

function harness(write: () => Promise<void>) {
  const source = createDocumentSourceState()
  const handle = {
    kind: 'file',
    name: 'draft.fig',
    createWritable: async () => ({ write, close: async () => undefined })
  } as FileSystemFileHandle
  source.setFileHandle(handle)
  const actions = createSaveActions({
    ...source,
    state: { ...createDefaultEditorState('page'), documentName: 'Draft' },
    buildFigFile: () => ({ data: new Uint8Array([1]), sceneVersion: 1 }),
    startWatchingFile: () => undefined
  })
  return { source, actions }
}

describe('document save status', () => {
  test('publishes a successful file timestamp only after the write completes and allows failure retry', async () => {
    let reject = true
    const { actions } = harness(async () => {
      if (reject) throw new Error('disk full')
    })
    expect(actions.getSaveStatus()).toMatchObject({ phase: 'idle', updatedAt: null })
    await expect(actions.saveFigFile()).rejects.toThrow('disk full')
    expect(actions.getSaveStatus()).toMatchObject({ phase: 'failed', updatedAt: null })
    reject = false
    expect(await actions.saveFigFile()).toBe(true)
    expect(actions.getSaveStatus()).toMatchObject({ phase: 'saved', destination: 'file' })
    expect(actions.getSaveStatus().updatedAt).not.toBeNull()
    reject = true
    const time = actions.getSaveStatus().updatedAt
    await expect(actions.saveFigFile()).rejects.toThrow('disk full')
    expect(actions.getSaveStatus()).toMatchObject({ phase: 'failed', updatedAt: time })
  })

  test('switching the source while writing clears status and ignores the late completion', async () => {
    let finish: () => void = () => undefined
    let signalStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const { actions, source } = harness(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
          signalStarted()
        })
    )
    const saving = actions.saveFigFile()
    await started
    expect(actions.getSaveStatus().phase).toBe('saving')
    source.markSourceChanged()
    expect(actions.getSaveStatus()).toMatchObject({ phase: 'idle', updatedAt: null })
    finish()
    expect(await saving).toBe(false)
    expect(actions.getSaveStatus()).toMatchObject({ phase: 'idle', updatedAt: null })
    expect(source.getSavedVersion()).toBe(0)
  })

  test('a closed document cannot mark itself saved after an in-flight write returns', async () => {
    let finish: () => void = () => undefined
    let signalStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const { actions, source } = harness(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
          signalStarted()
        })
    )
    const saving = actions.saveFigFile()
    await started
    actions.disposeSaveActions()
    finish()
    expect(await saving).toBe(false)
    expect(source.getSavedVersion()).toBe(0)
    expect(actions.getSaveStatus().updatedAt).toBeNull()
  })
})
