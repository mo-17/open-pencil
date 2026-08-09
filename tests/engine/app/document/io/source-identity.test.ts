import { describe, expect, test, vi } from 'bun:test'

import { createDefaultEditorState } from '@open-pencil/core/editor'

import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'

function makeWritableHandle(name: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    createWritable: vi.fn(async () => ({
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    }))
  } as FileSystemFileHandle
}

function createSaveHarness(handle: FileSystemFileHandle) {
  const state = {
    ...createDefaultEditorState('page'),
    documentName: 'Untitled'
  }
  const setSourceIdentity = vi.fn()
  let sourceRevision = 0
  const actions = createSaveActions({
    state,
    buildFigFile: () => ({ data: new Uint8Array([1, 2, 3]), sceneVersion: 0 }),
    getFilePath: () => null,
    setFilePath: vi.fn(),
    getFileHandle: () => handle,
    setFileHandle: vi.fn(),
    getDownloadName: () => null,
    setDownloadName: vi.fn(),
    getStorageBinding: () => null,
    setStorageBinding: vi.fn(),
    setSourceIdentity,
    getSourceRevision: () => sourceRevision,
    markSourceChanged: () => {
      sourceRevision++
    },
    setSavedVersion: vi.fn(),
    setLastWriteTime: vi.fn(),
    startWatchingFile: vi.fn()
  })
  return { actions, setSourceIdentity }
}

describe('saved document identity', () => {
  test('tracks storage binding alongside local source identity', () => {
    const source = createDocumentSourceState()
    source.setSourceIdentity({ handle: null, path: '/tmp/local.fig' })
    source.setStorageBinding({ providerId: 's3-compatible', documentId: 'remote-1' })

    expect(source.getSourceIdentity()).toEqual({ handle: null, path: '/tmp/local.fig' })
    expect(source.getStorageBinding()).toEqual({
      providerId: 's3-compatible',
      profileId: 'default',
      documentId: 'remote-1'
    })
  })

  test('notifies and detaches source identity listeners without breaking saves', () => {
    const source = createDocumentSourceState()
    const listener = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const unbind = source.onSourceChanged(listener)
    source.onSourceChanged(() => {
      throw new Error('listener failed')
    })

    source.markSourceChanged()
    unbind()
    source.markSourceChanged()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(source.getSourceRevision()).toBe(2)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  test('publishes the writable handle after a successful save', async () => {
    const handle = makeWritableHandle('saved.fig')
    const { actions, setSourceIdentity } = createSaveHarness(handle)

    await actions.saveFigFile()

    expect(setSourceIdentity).toHaveBeenCalledWith({ handle, path: null })
  })

  test('does not publish an identity when writing fails', async () => {
    const handle = {
      kind: 'file',
      name: 'failed.fig',
      createWritable: vi.fn(async () => {
        throw new Error('write failed')
      })
    } as FileSystemFileHandle
    const { actions, setSourceIdentity } = createSaveHarness(handle)

    await expect(actions.saveFigFile()).rejects.toThrow('write failed')
    expect(setSourceIdentity).not.toHaveBeenCalled()
  })

  test('serializes overlapping saves so an older snapshot cannot finish last', async () => {
    let releaseFirstWrite: () => void = () => undefined
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    let signalFirstWrite: () => void = () => undefined
    const firstWriteStarted = new Promise<void>((resolve) => {
      signalFirstWrite = resolve
    })
    const writtenBytes: number[][] = []
    const handle = {
      kind: 'file',
      name: 'saved.fig',
      createWritable: vi.fn(async () => ({
        write: vi.fn(async (data: Uint8Array) => {
          writtenBytes.push([...data])
          if (writtenBytes.length === 1) {
            signalFirstWrite()
            await firstWriteGate
          }
        }),
        close: vi.fn(async () => undefined)
      }))
    } as FileSystemFileHandle
    const state = {
      ...createDefaultEditorState('page'),
      documentName: 'Untitled'
    }
    const savedVersions: number[] = []
    let buildCount = 0
    let sourceRevision = 0
    const buildFigFile = vi.fn(() => {
      buildCount += 1
      return { data: new Uint8Array([buildCount]), sceneVersion: buildCount }
    })
    const actions = createSaveActions({
      state,
      buildFigFile,
      getFilePath: () => null,
      setFilePath: vi.fn(),
      getFileHandle: () => handle,
      setFileHandle: vi.fn(),
      getDownloadName: () => null,
      setDownloadName: vi.fn(),
      getStorageBinding: () => null,
      setStorageBinding: vi.fn(),
      setSourceIdentity: vi.fn(),
      getSourceRevision: () => sourceRevision,
      markSourceChanged: () => {
        sourceRevision++
      },
      setSavedVersion: (version) => savedVersions.push(version),
      setLastWriteTime: vi.fn(),
      startWatchingFile: vi.fn()
    })

    const firstSave = actions.saveFigFile()
    await firstWriteStarted
    const secondSave = actions.saveFigFile()
    await Promise.resolve()

    expect(buildFigFile).toHaveBeenCalledTimes(1)
    releaseFirstWrite()
    await Promise.all([firstSave, secondSave])

    expect(writtenBytes).toEqual([[1], [2]])
    expect(savedVersions).toEqual([1, 2])
  })

  test('does not redirect an in-flight snapshot when the document source changes', async () => {
    let finishBuild: () => void = () => undefined
    const buildGate = new Promise<void>((resolve) => {
      finishBuild = resolve
    })
    let signalBuild: () => void = () => undefined
    const buildStarted = new Promise<void>((resolve) => {
      signalBuild = resolve
    })
    const oldHandle = makeWritableHandle('old.fig')
    const newHandle = makeWritableHandle('new.fig')
    let activeHandle = oldHandle
    let sourceRevision = 0
    const savedVersions: number[] = []
    const actions = createSaveActions({
      state: {
        ...createDefaultEditorState('page'),
        documentName: 'Old document'
      },
      buildFigFile: async () => {
        signalBuild()
        await buildGate
        return { data: new Uint8Array([1]), sceneVersion: 7 }
      },
      getFilePath: () => null,
      setFilePath: vi.fn(),
      getFileHandle: () => activeHandle,
      setFileHandle: vi.fn(),
      getDownloadName: () => null,
      setDownloadName: vi.fn(),
      getStorageBinding: () => null,
      setStorageBinding: vi.fn(),
      setSourceIdentity: vi.fn(),
      getSourceRevision: () => sourceRevision,
      markSourceChanged: () => {
        sourceRevision++
      },
      setSavedVersion: (version) => savedVersions.push(version),
      setLastWriteTime: vi.fn(),
      startWatchingFile: vi.fn()
    })

    const saving = actions.saveFigFile()
    await buildStarted
    activeHandle = newHandle
    sourceRevision++
    finishBuild()
    await saving

    expect(oldHandle.createWritable).not.toHaveBeenCalled()
    expect(newHandle.createWritable).not.toHaveBeenCalled()
    expect(savedVersions).toEqual([])
  })

  test('does not build a file when Save As is cancelled', async () => {
    const previousWindow = Reflect.get(globalThis, 'window')
    const cancelled = new Error('cancelled')
    cancelled.name = 'AbortError'
    Reflect.set(globalThis, 'window', {
      showSaveFilePicker: vi.fn(async () => {
        throw cancelled
      })
    })
    const buildFigFile = vi.fn(() => ({ data: new Uint8Array([1]), sceneVersion: 1 }))
    let sourceRevision = 0
    const actions = createSaveActions({
      state: {
        ...createDefaultEditorState('page'),
        documentName: 'Untitled'
      },
      buildFigFile,
      getFilePath: () => null,
      setFilePath: vi.fn(),
      getFileHandle: () => null,
      setFileHandle: vi.fn(),
      getDownloadName: () => null,
      setDownloadName: vi.fn(),
      getStorageBinding: () => null,
      setStorageBinding: vi.fn(),
      setSourceIdentity: vi.fn(),
      getSourceRevision: () => sourceRevision,
      markSourceChanged: () => {
        sourceRevision++
      },
      setSavedVersion: vi.fn(),
      setLastWriteTime: vi.fn(),
      startWatchingFile: vi.fn()
    })

    try {
      await actions.saveFigFileAs()
      expect(buildFigFile).not.toHaveBeenCalled()
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
      else Reflect.set(globalThis, 'window', previousWindow)
    }
  })
})
