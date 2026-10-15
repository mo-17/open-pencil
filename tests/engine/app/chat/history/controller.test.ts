import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import type { UIMessage } from 'ai'
import { reactive } from 'vue'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createConversationHistory } from '@/app/ai/chat/history/controller'
import type { ChatDocumentEditor } from '@/app/ai/chat/history/document'
import { createConversationStore } from '@/app/ai/chat/history/idb'

import { expectDefined } from '#tests/helpers/assert'

function editor(graph = new SceneGraph()): ChatDocumentEditor {
  const id = crypto.randomUUID()
  return {
    graph,
    state: { documentName: 'Test document' },
    getRecoveryId: () => id,
    getSourceIdentity: () => ({ path: null, handle: null }),
    getDocumentFilePath: () => null,
    getStorageBinding: () => null
  }
}

test('adopting recovery in the same editor loads its selection instead of moving old chats', async () => {
  const store = createConversationStore()
  const active = editor()
  const history = createConversationHistory(
    {
      getEditor: () => active,
      ensureChat: async () => null,
      profileId: () => null,
      resetChat: async () => undefined,
      backend: () => 'direct'
    },
    store
  )
  await history.initialize()
  const original = history.current.value
  if (!original) throw new Error('Missing draft')
  await history.rename(original.id, 'Existing chat')
  const recoveryId = crypto.randomUUID()
  const restoredId = crypto.randomUUID()
  await store.write({
    ...original,
    id: restoredId,
    documentId: `recovery:${recoveryId}`,
    title: 'Recovered chat',
    titleSource: 'manual'
  })
  await store.select(`recovery:${recoveryId}`, restoredId)
  active.getRecoveryId = () => recoveryId
  await history.initialize()
  expect(history.current.value?.id).toBe(restoredId)
  expect((await store.read(original.id))?.documentId).toBe(original.documentId)
})

function fixture(initialEditor: ChatDocumentEditor = editor()) {
  let activeEditor = initialEditor
  let failWrites = false
  let resets = 0
  const store = createConversationStore()
  const chat = reactive({
    messages: [] as UIMessage[],
    status: 'ready' as const,
    stop: async () => undefined
  })
  const history = createConversationHistory(
    {
      getEditor: () => activeEditor,
      ensureChat: async () => chat,
      resetChat: async () => {
        resets++
      },
      profileId: () => null,
      backend: () => 'direct'
    },
    {
      ...store,
      write: async (row) => {
        if (failWrites) throw new DOMException('Storage full', 'QuotaExceededError')
        await store.write(row)
      }
    }
  )
  return {
    history,
    store,
    chat,
    setFail: (value: boolean) => {
      failWrites = value
    },
    getResets: () => resets,
    switchEditor: (nextEditor: ChatDocumentEditor = editor()) => {
      activeEditor = nextEditor
    }
  }
}

test('failed flush keeps the current conversation and blocks switching until retry succeeds', async () => {
  const f = fixture()
  await f.history.ensureChat()
  const id = f.history.current.value?.id
  f.chat.messages = [
    { id: 'message', role: 'user', parts: [{ type: 'text', text: 'Keep this draft' }] }
  ]
  f.setFail(true)
  await expect(f.history.newChat()).rejects.toThrow('Storage full')
  expect(f.history.current.value?.id).toBe(id)
  expect(f.history.messages.value[0]?.id).toBe('message')
  expect(f.history.storageError.value).toBe(true)
  f.setFail(false)
  await f.history.newChat()
  expect(f.history.current.value?.id).not.toBe(id)
  expect(f.history.storageError.value).toBe(false)
  if (!id) throw new Error('Missing conversation')
  expect((await f.store.read(id))?.messages[0]?.message.id).toBe('message')
})

test('queued chat switches finish on the last requested conversation without losing transcripts', async () => {
  const f = fixture()
  await f.history.initialize()
  const first = f.history.current.value?.id
  if (first) await f.history.rename(first, 'First')
  await f.history.newChat()
  const second = f.history.current.value?.id
  if (second) await f.history.rename(second, 'Second')
  if (!first || !second) throw new Error('Missing conversation')
  await Promise.all(
    Array.from({ length: 20 }, (_, index) => f.history.open(index % 2 === 0 ? first : second))
  )
  const current = expectDefined(f.history.current.value, 'current conversation')
  expect(current.id).toBe(second)
  expect(await f.store.getSelected(current.documentId)).toBe(second)
  expect(await f.store.read(first)).not.toBeNull()
  expect(f.history.busy.value).toBe(false)
})

test('opening the panel and repeatedly creating drafts does not persist empty chats', async () => {
  const f = fixture()
  await f.history.initialize()
  const documentId = f.history.current.value?.documentId
  await f.history.newChat()
  await f.history.newChat()
  expect(await f.store.list(documentId)).toEqual([])
  if (!documentId) throw new Error('Missing document')
  expect(await f.store.getSelected(documentId)).toBeNull()
})

test('a pending transport is rejected when the active document changes', async () => {
  let activeEditor = editor()
  const pending = Promise.withResolvers<{
    messages: UIMessage[]
    status: 'ready'
    stop: () => Promise<void>
  }>()
  const started = Promise.withResolvers<undefined>()
  let stops = 0
  const history = createConversationHistory(
    {
      getEditor: () => activeEditor,
      ensureChat: () => {
        started.resolve(undefined)
        return pending.promise
      },
      profileId: () => null,
      resetChat: async () => undefined,
      backend: () => 'direct'
    },
    createConversationStore()
  )
  const initializing = history.ensureChat()
  await started.promise
  activeEditor = editor()
  pending.resolve({
    messages: [],
    status: 'ready',
    stop: async () => {
      stops++
    }
  })
  expect(await initializing).toBeNull()
  expect(stops).toBe(1)
})

test('changing a saved document identity never moves the previous document transcript', async () => {
  const active = editor()
  let path = '/first.fig'
  active.getDocumentFilePath = () => path
  const store = createConversationStore()
  const history = createConversationHistory(
    {
      getEditor: () => active,
      ensureChat: async () => null,
      profileId: () => null,
      resetChat: async () => undefined,
      backend: () => 'direct'
    },
    store
  )
  await history.initialize()
  const first = history.current.value
  if (!first) throw new Error('Missing conversation')
  await history.rename(first.id, 'First document')
  path = '/second.fig'
  await history.initialize()
  expect(history.current.value?.id).not.toBe(first.id)
  expect(history.current.value?.documentId).toBe('file:/second.fig')
  expect((await store.read(first.id))?.documentId).toBe('file:/first.fig')
})

test('switching cloud account with an identical document ID keeps histories isolated', async () => {
  const active = editor()
  let accountId = 'account-one'
  active.getStorageBinding = () => ({
    providerId: 'google-drive',
    profileId: 'default',
    documentId: 'same-id',
    authority: { accountId, authorizationVersion: 'grant' }
  })
  const store = createConversationStore()
  const history = createConversationHistory(
    {
      getEditor: () => active,
      ensureChat: async () => null,
      profileId: () => null,
      resetChat: async () => undefined,
      backend: () => 'direct'
    },
    store
  )
  await history.initialize()
  const first = history.current.value
  if (!first) throw new Error('Missing conversation')
  await history.rename(first.id, 'First account')
  accountId = 'account-two'
  await history.initialize()
  expect(history.current.value?.id).not.toBe(first.id)
  expect(history.current.value?.documentId).not.toBe(first.documentId)
  expect((await store.read(first.id))?.documentId).toBe(first.documentId)
})

test('suspending a live conversation serializes final save and reset before same-document initialization', async () => {
  const activeEditor = editor()
  const store = createConversationStore()
  const stopping = Promise.withResolvers<undefined>()
  const stopped = Promise.withResolvers<undefined>()
  const events: string[] = []
  // Keep automatic Vue persistence out of this controlled final-save ordering contract.
  const live = {
    messages: [] as UIMessage[],
    status: 'streaming' as 'streaming' | 'ready',
    stop: async () => {
      events.push('stop')
      stopping.resolve(undefined)
      await stopped.promise
      live.status = 'ready'
    }
  }
  const history = createConversationHistory(
    {
      getEditor: () => activeEditor,
      ensureChat: async () => live,
      profileId: () => null,
      backend: () => 'direct',
      resetChat: async () => {
        events.push('reset')
      }
    },
    {
      ...store,
      write: async (conversation) => {
        events.push('save')
        await store.write(conversation)
      }
    }
  )
  await history.ensureChat()
  const suspensionEventStart = events.length
  const conversationId = expectDefined(history.current.value?.id, 'live conversation')
  live.messages = [
    { id: 'owned-request', role: 'user', parts: [{ type: 'text', text: 'Keep this request' }] }
  ]
  const suspension = history.suspend()
  const reinitialization = history.initialize()
  try {
    await stopping.promise
    expect(events.slice(suspensionEventStart)).toEqual(['stop'])
    expect(history.busy.value).toBe(true)
    stopped.resolve(undefined)
    await suspension
    await reinitialization
    expect(events.slice(suspensionEventStart)).toEqual(['stop', 'save', 'reset'])
    expect(history.current.value?.id).toBe(conversationId)
    expect(history.messages.value.map((message) => message.id)).toEqual(['owned-request'])
    expect((await store.read(conversationId))?.interrupted).toBe(true)
    expect(history.busy.value).toBe(false)
  } finally {
    stopped.resolve(undefined)
    await Promise.allSettled([suspension, reinitialization])
  }
})

test('a failed public suspension keeps the old transcript and blocks reset until its final save succeeds', async () => {
  const f = fixture()
  await f.history.ensureChat()
  const resetsBeforeSuspension = f.getResets()
  const conversationId = expectDefined(f.history.current.value?.id, 'owned conversation')
  f.chat.messages = [
    {
      id: 'unsaved-owner-request',
      role: 'user',
      parts: [{ type: 'text', text: 'Retain this request' }]
    }
  ]
  f.setFail(true)
  await expect(f.history.suspend()).rejects.toThrow('Storage full')
  expect(f.history.current.value?.id).toBe(conversationId)
  expect(f.history.messages.value.map((message) => message.id)).toEqual(['unsaved-owner-request'])
  expect(f.getResets()).toBe(resetsBeforeSuspension)
  f.setFail(false)
  await f.history.suspend()
  await f.history.initialize()
  expect(f.getResets()).toBe(resetsBeforeSuspension + 1)
  expect(f.history.current.value?.id).toBe(conversationId)
  expect((await f.store.read(conversationId))?.messages[0]?.message.id).toBe(
    'unsaved-owner-request'
  )
})

test('saving an untitled graph preserves its conversation and promotes its document identity', async () => {
  const active = editor()
  let path: string | null = null
  active.getDocumentFilePath = () => path
  const f = fixture(active)
  await f.history.ensureChat()
  const original = expectDefined(f.history.current.value, 'original conversation')
  f.chat.messages = [
    {
      id: 'before-first-save',
      role: 'user',
      parts: [{ type: 'text', text: 'Keep this conversation' }]
    }
  ]
  await f.history.flush()
  await f.history.newChat()
  const additional = expectDefined(f.history.current.value, 'additional conversation')
  await f.history.rename(additional.id, 'Another conversation before saving')
  await f.history.open(original.id)
  path = '/first-save.fig'
  await f.history.initialize()
  expect(f.history.current.value?.id).toBe(original.id)
  expect(f.history.current.value?.documentId).toBe('file:/first-save.fig')
  expect(f.history.messages.value[0]?.id).toBe('before-first-save')
  expect((await f.store.read(original.id))?.documentId).toBe('file:/first-save.fig')
  expect((await f.store.read(additional.id))?.documentId).toBe('file:/first-save.fig')
  expect(await f.store.getSelected('file:/first-save.fig')).toBe(original.id)
  expect(await f.store.getSelected(original.documentId)).toBeNull()
  expect(await f.store.list(original.documentId)).toEqual([])
  await f.history.suspend()
})

test('reloading a saved path keeps its existing conversation after replacing the graph', async () => {
  let graph = new SceneGraph()
  const active = {
    ...editor(graph),
    get graph() {
      return graph
    }
  }
  active.getDocumentFilePath = () => '/same-path.fig'
  const f = fixture(active)
  await f.history.ensureChat()
  const original = expectDefined(f.history.current.value, 'original conversation')
  f.chat.messages = [
    {
      id: 'before-reload',
      role: 'user',
      parts: [{ type: 'text', text: 'Keep the same file history' }]
    }
  ]
  await f.history.flush()
  graph = new SceneGraph()
  await f.history.suspend()
  await f.history.initialize()
  expect(f.history.current.value?.id).toBe(original.id)
  expect(f.history.current.value?.documentId).toBe('file:/same-path.fig')
  expect(f.history.messages.value[0]?.id).toBe('before-reload')
  expect((await f.store.read(original.id))?.documentId).toBe(original.documentId)
})

for (const initializeBetween of [false, true]) {
  test(`importing a new graph never promotes the old recovery transcript with intermediate initialize=${initializeBetween}`, async () => {
    let graph = new SceneGraph()
    let path: string | null = null
    const active = {
      ...editor(graph),
      get graph() {
        return graph
      }
    }
    active.getDocumentFilePath = () => path
    const f = fixture(active)
    await f.history.ensureChat()
    const original = expectDefined(f.history.current.value, 'original conversation')
    f.chat.messages = [
      {
        id: 'old-document-request',
        role: 'user',
        parts: [{ type: 'text', text: 'Only the original document owns this' }]
      }
    ]
    await f.history.flush()
    graph = new SceneGraph()
    await f.history.suspend()
    if (initializeBetween) {
      await f.history.initialize()
      expect(f.history.current.value?.id).toBe(original.id)
    }
    path = '/imported-document.fig'
    await f.history.initialize()
    expect(f.history.current.value?.id).not.toBe(original.id)
    expect(f.history.current.value?.documentId).toBe('file:/imported-document.fig')
    expect(f.history.messages.value).toEqual([])
    const persisted = expectDefined(await f.store.read(original.id), 'persisted old conversation')
    expect(persisted.documentId).toBe(original.documentId)
    expect(persisted.messages.some((row) => row.message.id === 'old-document-request')).toBe(true)
    expect(await f.store.getSelected(original.documentId)).toBe(original.id)
  })
}

for (const activation of ['new-chat', 'open-chat', 'leave-and-return'] as const) {
  test(`a changed recovery graph cannot regain promotion through ${activation}`, async () => {
    let graph = new SceneGraph()
    let path: string | null = null
    const active = {
      ...editor(graph),
      get graph() {
        return graph
      }
    }
    active.getDocumentFilePath = () => path
    const f = fixture(active)
    await f.history.ensureChat()
    const original = expectDefined(f.history.current.value, 'original conversation')
    f.chat.messages = [
      {
        id: 'original-recovery-user',
        role: 'user',
        parts: [{ type: 'text', text: 'Preserve the original recovery history' }]
      }
    ]
    await f.history.flush()
    await f.history.newChat()
    const second = expectDefined(f.history.current.value, 'second conversation')
    await f.history.rename(second.id, 'Second original-document conversation')
    graph = new SceneGraph()
    await f.history.suspend()
    if (activation === 'new-chat') await f.history.newChat()
    else if (activation === 'open-chat') await f.history.open(original.id)
    else {
      f.switchEditor()
      await f.history.initialize()
      f.switchEditor(active)
      await f.history.initialize()
    }
    path = '/newly-imported-owner.fig'
    await f.history.initialize()
    expect(f.history.current.value?.documentId).toBe('file:/newly-imported-owner.fig')
    expect(f.history.current.value?.id).not.toBe(original.id)
    expect(f.history.current.value?.id).not.toBe(second.id)
    expect(f.history.messages.value).toEqual([])
    const retained = expectDefined(
      await f.store.read(original.id),
      'retained original conversation'
    )
    expect(retained.documentId).toBe(original.documentId)
    expect(retained.messages.some((row) => row.message.id === 'original-recovery-user')).toBe(true)
    expect((await f.store.read(second.id))?.documentId).toBe(original.documentId)
    expect((await f.store.list(original.documentId)).map((row) => row.id)).toContain(original.id)
    expect((await f.store.list(original.documentId)).map((row) => row.id)).toContain(second.id)
  })
}
