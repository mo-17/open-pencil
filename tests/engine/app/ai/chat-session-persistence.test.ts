import { describe, expect, test, vi } from 'bun:test'

import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import { computed, ref } from 'vue'

import type { AIProviderID } from '@open-pencil/core/constants'

import type {
  ACPSessionCapabilities,
  ACPSessionListItem,
  ACPSessionOpenedEvent,
  ACPSessionSetupEvent
} from '@/app/ai/acp/transport'
import { createACPModelConfigurationId } from '@/app/ai/chat/acp-session-persistence'
import {
  ACP_CHAT_CONTEXT_VERSION,
  createChatSessionManager,
  type CreateACPTransportFactory,
  type CreateACPTransportOptions,
  type ManagedACPTransport
} from '@/app/ai/chat/transports'
import type { ResolvedAIModelRole } from '@/app/ai/models'
import {
  createMemoryAISessionStore,
  pathDocumentAlias,
  type ACPSessionScope,
  type AIDocumentScopeId,
  type AISessionStore
} from '@/app/ai/sessions'
import type { getActiveEditorStore } from '@/app/editor/active-store'

type EditorStore = ReturnType<typeof getActiveEditorStore>

type TransportStart = {
  providerId: AIProviderID
  initialSessionId: string | null
  opened: ACPSessionOpenedEvent
}

const SESSION_CAPABILITIES: ACPSessionCapabilities = {
  list: true,
  resume: true,
  load: true
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function resolvedRole(
  providerId: AIProviderID = 'acp:codex',
  profileId: `model-${string}` = 'model-codex'
): ResolvedAIModelRole {
  return {
    requestedRole: 'design',
    profile: {
      id: profileId,
      name: profileId,
      connectionId: `connection-${providerId}`,
      modelID: '',
      customModelID: '',
      maxOutputTokens: 16_384,
      capabilities: ['tools'],
      featurePolicy: {
        webSearch: { enabled: false },
        codeExecution: { enabled: false },
        mcpServerIds: []
      }
    },
    connection: {
      id: `connection-${providerId}`,
      providerID: providerId,
      customBaseURL: '',
      customAPIType: 'responses',
      credentialProfileId: `credential-${providerId}`
    }
  }
}

function editorStore(path: string): EditorStore {
  return {
    getStorageBinding: () => null,
    getSourceIdentity: () => ({ handle: null, path })
  } as EditorStore
}

function mutableEditorStore(initialPath: string | null) {
  let path = initialPath
  const listeners = new Set<() => void>()
  const store = {
    getStorageBinding: () => null,
    getSourceIdentity: () => ({ handle: null, path }),
    onSourceChanged(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  } as EditorStore
  return {
    store,
    setPath(nextPath: string | null) {
      path = nextPath
      for (const listener of listeners) listener()
    }
  }
}

function fakeACPTransportFactory(
  starts: TransportStart[],
  options: { resumePersisted?: boolean } = {}
): CreateACPTransportFactory {
  let nextSessionId = 0
  return async (providerId, optionsOrCallback) => {
    const transportOptions: CreateACPTransportOptions =
      typeof optionsOrCallback === 'function'
        ? { onConfigOptionsChange: optionsOrCallback }
        : (optionsOrCallback ?? {})
    const initialSessionId = transportOptions.initialSessionId ?? null
    const resume = initialSessionId !== null && options.resumePersisted !== false
    const opened: ACPSessionOpenedEvent = {
      sessionId: resume ? initialSessionId : `new-session-${++nextSessionId}`,
      method: resume ? 'resume' : 'new',
      ...(!resume && initialSessionId ? { restoreError: 'test restore failure' } : {})
    }
    let openedPublished = false
    const transport: ChatTransport<UIMessage> & {
      connect(): Promise<void>
      destroy(): Promise<void>
      setSessionConfigOption(configId: string, value: string): Promise<void>
    } = {
      async connect() {
        starts.push({ providerId, initialSessionId, opened })
        transportOptions.onSessionSetup?.({
          ...opened,
          capabilities: { ...SESSION_CAPABILITIES }
        })
      },
      async destroy() {
        return undefined
      },
      async setSessionConfigOption() {
        return undefined
      },
      async sendMessages() {
        if (!openedPublished) {
          openedPublished = true
          transportOptions.onSessionOpened?.(opened)
        }
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start' })
            controller.enqueue({ type: 'start-step' })
            controller.enqueue({ type: 'finish-step' })
            controller.enqueue({ type: 'finish', finishReason: 'stop' })
            controller.close()
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }
    return transport
  }
}

type PlannedTransport = {
  setup?: ACPSessionSetupEvent
  connectGate?: Promise<void>
  connectError?: Error
  listSessions?: () => Promise<ACPSessionListItem[]>
}

type PlannedTransportRecord = {
  providerId: AIProviderID
  options: CreateACPTransportOptions
  transport: ManagedACPTransport
  destroyed: boolean
  sends: number
}

function plannedACPTransportFactory(
  plans: PlannedTransport[],
  records: PlannedTransportRecord[]
): CreateACPTransportFactory {
  return async (providerId, optionsOrCallback) => {
    const options: CreateACPTransportOptions =
      typeof optionsOrCallback === 'function'
        ? { onConfigOptionsChange: optionsOrCallback }
        : (optionsOrCallback ?? {})
    const plan = plans[records.length] ?? {}
    const initialSessionId = options.initialSessionId ?? null
    const setup: ACPSessionSetupEvent = plan.setup ?? {
      sessionId: initialSessionId ?? `planned-session-${records.length + 1}`,
      method: initialSessionId ? 'resume' : 'new',
      capabilities: { ...SESSION_CAPABILITIES }
    }
    let opened = false
    const record = {} as PlannedTransportRecord
    const transport: ManagedACPTransport = {
      async connect() {
        await plan.connectGate
        if (plan.connectError) throw plan.connectError
        options.onSessionSetup?.(setup)
      },
      async destroy() {
        record.destroyed = true
      },
      async setSessionConfigOption() {
        return undefined
      },
      async sendMessages() {
        record.sends += 1
        if (!opened) {
          opened = true
          options.onSessionOpened?.({
            sessionId: setup.sessionId,
            method: setup.method,
            ...(setup.restoreError ? { restoreError: setup.restoreError } : {})
          })
        }
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start' })
            controller.enqueue({ type: 'start-step' })
            controller.enqueue({ type: 'finish-step' })
            controller.enqueue({ type: 'finish', finishReason: 'stop' })
            controller.close()
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }
    if (plan.listSessions) transport.listSessions = plan.listSessions
    Object.assign(record, {
      providerId,
      options,
      transport,
      destroyed: false,
      sends: 0
    })
    records.push(record)
    return transport
  }
}

async function sessionScope(
  documentScopeId: AIDocumentScopeId,
  role: ResolvedAIModelRole,
  configurationContext: unknown = null
): Promise<ACPSessionScope> {
  const providerId = role.connection.providerID
  if (!providerId.startsWith('acp:')) throw new Error('Expected an ACP role')
  return {
    documentScopeId,
    role: 'design',
    providerId,
    agentId: providerId.slice(4) as ACPSessionScope['agentId'],
    connectionId: role.connection.id,
    modelProfileId: role.profile.id,
    modelConfigurationId: await createACPModelConfigurationId(role, configurationContext),
    credentialProfileId: role.connection.credentialProfileId,
    contextVersion: ACP_CHAT_CONTEXT_VERSION
  }
}

async function waitForStoredSession(
  read: () => Promise<string | null>,
  expected: string | null
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await read()) === expected) return
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }
  throw new Error(`Timed out waiting for stored ACP session ${expected}`)
}

async function waitForCondition(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }
  throw new Error(message)
}

function createPersistentManager(options: {
  store: EditorStore
  role: ResolvedAIModelRole
  sessionStore: AISessionStore
  starts: TransportStart[]
  resumePersisted?: boolean
  configurationContext?: unknown
}) {
  return createChatSessionManager({
    isConfigured: computed(() => true),
    isACPProvider: computed(() => true),
    providerID: ref(options.role.connection.providerID),
    credentialsReady: Promise.resolve(),
    getActiveEditorStore: () => options.store,
    createACPTransportFactory: fakeACPTransportFactory(options.starts, {
      resumePersisted: options.resumePersisted
    }),
    acpSessionStore: options.sessionStore,
    resolveACPModelRole: () => options.role,
    resolveACPConfigurationContext: () => options.configurationContext ?? null
  })
}

function createPlannedManager(options: {
  getStore: () => EditorStore
  role: ResolvedAIModelRole
  plans: PlannedTransport[]
  records: PlannedTransportRecord[]
  sessionStore?: AISessionStore
}) {
  return createChatSessionManager({
    isConfigured: computed(() => true),
    isACPProvider: computed(() => true),
    providerID: ref(options.role.connection.providerID),
    credentialsReady: Promise.resolve(),
    getActiveEditorStore: options.getStore,
    createACPTransportFactory: plannedACPTransportFactory(options.plans, options.records),
    acpSessionStore: options.sessionStore,
    resolveACPModelRole: () => options.role
  })
}

async function sendPrompt(manager: ReturnType<typeof createPersistentManager>, text = 'test') {
  const chat = await manager.ensureChat()
  if (!chat) throw new Error('Missing chat')
  await chat.sendMessage({ text })
  return chat
}

describe('ACP chat session persistence integration', () => {
  test('resumes a saved document after recreating the manager', async () => {
    const sessionStore = createMemoryAISessionStore()
    const store = editorStore('/tmp/persisted.fig')
    const role = resolvedRole()
    const starts: TransportStart[] = []
    const first = createPersistentManager({ store, role, sessionStore, starts })

    await first.ensureChat()
    expect(starts[0]).toMatchObject({ initialSessionId: null, opened: { method: 'new' } })
    expect(first.acpSessionStatus.value).toEqual({
      state: 'new',
      sessionId: starts[0].opened.sessionId,
      requestedSessionId: null,
      source: 'automatic',
      error: null,
      persistenceError: null,
      capabilities: SESSION_CAPABILITIES
    })

    const documentScopeId = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/persisted.fig'),
      'ai-doc-probe'
    )
    const scope = await sessionScope(documentScopeId, role)
    expect(await sessionStore.readACPSession(scope)).toBeNull()
    await sendPrompt(first)
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(scope))?.sessionId ?? null,
      starts[0].opened.sessionId
    )

    const second = createPersistentManager({ store, role, sessionStore, starts })
    await second.ensureChat()
    expect(starts[1]).toMatchObject({
      initialSessionId: starts[0].opened.sessionId,
      opened: { sessionId: starts[0].opened.sessionId, method: 'resume' }
    })
    expect(second.acpSessionStatus.value).toMatchObject({
      state: 'resumed',
      sessionId: starts[0].opened.sessionId,
      requestedSessionId: starts[0].opened.sessionId,
      source: 'automatic',
      error: null
    })
    await sendPrompt(second)

    await second.resetChat()
    await first.resetChat()
  })

  test('does not persist an unused prewarmed session', async () => {
    const sessionStore = createMemoryAISessionStore()
    const store = editorStore('/tmp/prewarmed-only.fig')
    const role = resolvedRole()
    const starts: TransportStart[] = []
    const first = createPersistentManager({ store, role, sessionStore, starts })

    await first.ensureChat()
    const second = createPersistentManager({ store, role, sessionStore, starts })
    await second.ensureChat()

    expect(starts.map((start) => start.initialSessionId)).toEqual([null, null])
    await sendPrompt(second)
    await second.resetChat()
    await first.resetChat()
  })

  test('isolates the same profile when its runtime configuration changes', async () => {
    const sessionStore = createMemoryAISessionStore()
    const store = editorStore('/tmp/configuration.fig')
    const role = resolvedRole()
    const starts: TransportStart[] = []
    const firstContext = [{ id: 'mcp-one', url: 'https://one.example/mcp' }]
    const secondContext = [{ id: 'mcp-one', url: 'https://two.example/mcp' }]
    const first = createPersistentManager({
      store,
      role,
      sessionStore,
      starts,
      configurationContext: firstContext
    })
    await sendPrompt(first)

    const second = createPersistentManager({
      store,
      role,
      sessionStore,
      starts,
      configurationContext: secondContext
    })
    await second.ensureChat()

    expect(starts[1]?.initialSessionId).toBeNull()
    await second.resetChat()
    await first.resetChat()
  })

  test('clears only the active document binding', async () => {
    const sessionStore = createMemoryAISessionStore()
    const role = resolvedRole()
    const storeA = editorStore('/tmp/document-a.fig')
    const storeB = editorStore('/tmp/document-b.fig')
    let activeStore = storeA
    const starts: TransportStart[] = []
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => true),
      providerID: ref(role.connection.providerID),
      credentialsReady: Promise.resolve(),
      getActiveEditorStore: () => activeStore,
      createACPTransportFactory: fakeACPTransportFactory(starts),
      acpSessionStore: sessionStore,
      resolveACPModelRole: () => role
    })

    await sendPrompt(manager, 'document A')
    activeStore = storeB
    await sendPrompt(manager, 'document B')

    const documentA = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/document-a.fig'),
      'ai-doc-probe-a'
    )
    const documentB = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/document-b.fig'),
      'ai-doc-probe-b'
    )
    const scopeA = await sessionScope(documentA, role)
    const scopeB = await sessionScope(documentB, role)
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(scopeA))?.sessionId ?? null,
      starts[0].opened.sessionId
    )
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(scopeB))?.sessionId ?? null,
      starts[1].opened.sessionId
    )

    await manager.resetChat()
    expect(await sessionStore.readACPSession(scopeA)).not.toBeNull()
    expect(await sessionStore.readACPSession(scopeB)).toBeNull()

    activeStore = storeA
    await manager.resetChat()
    expect(await sessionStore.readACPSession(scopeA)).toBeNull()
  })

  test('Clear during a tab switch targets the new tab and preserves the previous transcript', async () => {
    const sessionStore = createMemoryAISessionStore()
    const role = resolvedRole()
    const storeA = editorStore('/tmp/clear-switch-a.fig')
    const storeB = editorStore('/tmp/clear-switch-b.fig')
    let activeStore = storeA
    const starts: TransportStart[] = []
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => true),
      providerID: ref(role.connection.providerID),
      credentialsReady: Promise.resolve(),
      getActiveEditorStore: () => activeStore,
      createACPTransportFactory: fakeACPTransportFactory(starts),
      acpSessionStore: sessionStore,
      resolveACPModelRole: () => role
    })
    await sendPrompt(manager, 'tab A')
    activeStore = storeB
    await sendPrompt(manager, 'tab B')

    const documentA = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/clear-switch-a.fig'),
      'ai-doc-probe-clear-switch-a'
    )
    const documentB = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/clear-switch-b.fig'),
      'ai-doc-probe-clear-switch-b'
    )
    const scopeA = await sessionScope(documentA, role)
    const scopeB = await sessionScope(documentB, role)

    activeStore = storeA
    await manager.resetChat()
    expect(await sessionStore.readACPSession(scopeA)).toBeNull()
    expect(await sessionStore.readACPSession(scopeB)).not.toBeNull()

    activeStore = storeB
    const restoredB = await manager.ensureChat()
    if (!restoredB) throw new Error('Missing restored B chat')
    expect(restoredB.messages.some((message) => message.role === 'user')).toBeTrue()
    expect(starts.at(-1)?.initialSessionId).toBe(starts[1].opened.sessionId)
    await manager.resetChat()
  })

  test('surfaces a durable session write failure without disabling the active chat', async () => {
    const sessionStore = createMemoryAISessionStore()
    const failure = new Error('session storage unavailable')
    vi.spyOn(sessionStore, 'writeACPSession').mockRejectedValueOnce(failure)
    const store = editorStore('/tmp/persistence-error.fig')
    const role = resolvedRole()
    const starts: TransportStart[] = []
    const manager = createPersistentManager({ store, role, sessionStore, starts })

    const activeChat = await manager.ensureChat()
    if (!activeChat) throw new Error('Missing active chat')
    await activeChat.sendMessage({ text: 'open the session' })
    await waitForCondition(
      () => manager.acpSessionStatus.value.persistenceError === failure.message,
      'Persistence failure was not surfaced'
    )

    expect(manager.acpSessionStatus.value).toMatchObject({
      state: 'new',
      sessionId: starts[0].opened.sessionId,
      error: null,
      persistenceError: failure.message
    })
    await activeChat.sendMessage({ text: 'the live session still works' })
    expect(activeChat.status).toBe('ready')
    await manager.resetChat()
  })

  test('waits for durable Clear deletion before opening a replacement session', async () => {
    const baseStore = createMemoryAISessionStore()
    const deleteStarted = deferred()
    const allowDelete = deferred()
    const sessionStore: AISessionStore = {
      ...baseStore,
      async deleteACPSession(scope) {
        deleteStarted.resolve()
        await allowDelete.promise
        await baseStore.deleteACPSession(scope)
      }
    }
    const store = editorStore('/tmp/clear-race.fig')
    const role = resolvedRole()
    const starts: TransportStart[] = []
    const manager = createPersistentManager({ store, role, sessionStore, starts })
    await sendPrompt(manager)

    const clearing = manager.resetChat()
    await deleteStarted.promise
    const replacement = manager.ensureChat()
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(starts).toHaveLength(1)

    allowDelete.resolve()
    await clearing
    await replacement
    expect(starts[1]?.initialSessionId).toBeNull()
    await manager.resetChat()
  })

  test('persists an in-memory session when an unsaved document is first saved', async () => {
    const sessionStore = createMemoryAISessionStore()
    const document = mutableEditorStore(null)
    const role = resolvedRole()
    const starts: TransportStart[] = []
    const manager = createPersistentManager({
      store: document.store,
      role,
      sessionStore,
      starts
    })
    await sendPrompt(manager, 'before save')

    document.setPath('/tmp/first-save.fig')
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    const documentScopeId = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/first-save.fig'),
      'ai-doc-probe-first-save'
    )
    const scope = await sessionScope(documentScopeId, role)
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(scope))?.sessionId ?? null,
      starts[0].opened.sessionId
    )

    const reopenedStarts: TransportStart[] = []
    const reopened = createPersistentManager({
      store: editorStore('/tmp/first-save.fig'),
      role,
      sessionStore,
      starts: reopenedStarts
    })
    await reopened.ensureChat()
    expect(reopenedStarts[0]?.initialSessionId).toBe(starts[0].opened.sessionId)
    await reopened.resetChat()
    await manager.resetChat()
  })

  test('treats Save As as a new document without stealing the source session', async () => {
    const sessionStore = createMemoryAISessionStore()
    const document = mutableEditorStore('/tmp/save-as-source.fig')
    const role = resolvedRole()
    const starts: TransportStart[] = []
    const manager = createPersistentManager({
      store: document.store,
      role,
      sessionStore,
      starts
    })
    await sendPrompt(manager, 'source document')

    document.setPath('/tmp/save-as-copy.fig')
    await sendPrompt(manager, 'copied document')
    expect(starts[1]?.initialSessionId).toBeNull()

    const sourceDocumentId = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/save-as-source.fig'),
      'ai-doc-probe-save-as-source'
    )
    const copyDocumentId = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/save-as-copy.fig'),
      'ai-doc-probe-save-as-copy'
    )
    expect(copyDocumentId).not.toBe(sourceDocumentId)
    const sourceScope = await sessionScope(sourceDocumentId, role)
    const copyScope = await sessionScope(copyDocumentId, role)
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(sourceScope))?.sessionId ?? null,
      starts[0].opened.sessionId
    )
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(copyScope))?.sessionId ?? null,
      starts[1].opened.sessionId
    )

    await manager.resetChat()
    expect(await sessionStore.readACPSession(copyScope)).toBeNull()
    expect(await sessionStore.readACPSession(sourceScope)).not.toBeNull()
  })

  test('signals a visible notice when a persisted session falls back to new', async () => {
    const sessionStore = createMemoryAISessionStore()
    const store = editorStore('/tmp/fallback.fig')
    const role = resolvedRole()
    const documentScopeId = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/fallback.fig'),
      'ai-doc-fallback'
    )
    const scope = await sessionScope(documentScopeId, role)
    await sessionStore.writeACPSession(scope, 'stale-session')
    const starts: TransportStart[] = []
    const manager = createPersistentManager({
      store,
      role,
      sessionStore,
      starts,
      resumePersisted: false
    })

    await manager.ensureChat()
    expect(starts[0]).toMatchObject({
      initialSessionId: 'stale-session',
      opened: { method: 'new', restoreError: 'test restore failure' }
    })
    expect(manager.acpSessionStatus.value).toMatchObject({
      state: 'fallback',
      sessionId: starts[0].opened.sessionId,
      requestedSessionId: 'stale-session',
      source: 'automatic',
      error: 'test restore failure'
    })
    expect(manager.acpSessionRestoreNotice.value).toBeNull()
    await sendPrompt(manager)
    expect(manager.acpSessionRestoreNotice.value).not.toBeNull()
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(scope))?.sessionId ?? null,
      starts[0].opened.sessionId
    )
    await manager.resetChat()
  })

  test('force stop preserves a resumable ACP binding and its local transcript', async () => {
    const sessionStore = createMemoryAISessionStore()
    const store = editorStore('/tmp/force-stop.fig')
    const role = resolvedRole()
    const starts: TransportStart[] = []
    const manager = createPersistentManager({ store, role, sessionStore, starts })
    const firstChat = await sendPrompt(manager, 'keep this turn')
    expect(firstChat.messages.some((message) => message.role === 'user')).toBeTrue()

    await manager.forceStopChat()
    const replacement = await manager.ensureChat()
    if (!replacement) throw new Error('Missing replacement chat')

    expect(starts[1]?.initialSessionId).toBe(starts[0].opened.sessionId)
    expect(replacement.messages.some((message) => message.role === 'user')).toBeTrue()
    await manager.resetChat()
  })

  test('clear deletes a stale binding after resume and fallback setup both fail', async () => {
    const sessionStore = createMemoryAISessionStore()
    const store = editorStore('/tmp/double-failure.fig')
    const role = resolvedRole()
    const documentScopeId = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/double-failure.fig'),
      'ai-doc-double-failure'
    )
    const scope = await sessionScope(documentScopeId, role)
    await sessionStore.writeACPSession(scope, 'unrecoverable-session')
    const attemptedInitialIds: Array<string | null> = []
    const failingFactory: CreateACPTransportFactory = async (_providerId, optionsOrCallback) => {
      const transportOptions =
        typeof optionsOrCallback === 'function' ? {} : (optionsOrCallback ?? {})
      return {
        async connect() {
          attemptedInitialIds.push(transportOptions.initialSessionId ?? null)
          throw new Error('resume and fallback failed')
        },
        async destroy() {
          return undefined
        },
        async setSessionConfigOption() {
          return undefined
        },
        async sendMessages() {
          throw new Error('unreachable')
        },
        async reconnectToStream() {
          return null
        }
      }
    }
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => true),
      providerID: ref(role.connection.providerID),
      credentialsReady: Promise.resolve(),
      getActiveEditorStore: () => store,
      createACPTransportFactory: failingFactory,
      acpSessionStore: sessionStore,
      resolveACPModelRole: () => role
    })

    await expect(manager.ensureChat()).rejects.toThrow('resume and fallback failed')
    expect(manager.acpSessionStatus.value).toMatchObject({
      state: 'failed',
      sessionId: null,
      requestedSessionId: 'unrecoverable-session',
      source: 'automatic',
      error: 'resume and fallback failed'
    })
    await manager.resetChat()
    expect(await sessionStore.readACPSession(scope)).toBeNull()

    const replacementStarts: TransportStart[] = []
    const replacement = createPersistentManager({
      store,
      role,
      sessionStore,
      starts: replacementStarts
    })
    await replacement.ensureChat()
    expect(attemptedInitialIds).toEqual(['unrecoverable-session'])
    expect(replacementStarts[0]?.initialSessionId).toBeNull()
    await replacement.resetChat()
  })

  test('updates the active binding before reporting a later fallback', async () => {
    const sessionStore = createMemoryAISessionStore()
    const store = editorStore('/tmp/reopened-twice.fig')
    const role = resolvedRole()
    let publishOpened: ((event: ACPSessionOpenedEvent) => void) | undefined
    let publishedInitial = false
    const factory: CreateACPTransportFactory = async (_providerId, optionsOrCallback) => {
      const transportOptions: CreateACPTransportOptions =
        typeof optionsOrCallback === 'function'
          ? { onConfigOptionsChange: optionsOrCallback }
          : (optionsOrCallback ?? {})
      publishOpened = transportOptions.onSessionOpened
      return {
        async connect() {
          return undefined
        },
        async destroy() {
          return undefined
        },
        async setSessionConfigOption() {
          return undefined
        },
        async sendMessages() {
          if (!publishedInitial) {
            publishedInitial = true
            publishOpened?.({ sessionId: 'first-new-session', method: 'new' })
          }
          return new ReadableStream<UIMessageChunk>({
            start(controller) {
              controller.close()
            }
          })
        },
        async reconnectToStream() {
          return null
        }
      }
    }
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => true),
      providerID: ref(role.connection.providerID),
      credentialsReady: Promise.resolve(),
      getActiveEditorStore: () => store,
      createACPTransportFactory: factory,
      acpSessionStore: sessionStore,
      resolveACPModelRole: () => role
    })
    const chat = await manager.ensureChat()
    if (!chat) throw new Error('Missing chat')
    await chat.sendMessage({ text: 'first session' })
    expect(manager.acpSessionRestoreNotice.value).toBeNull()

    publishOpened?.({
      sessionId: 'second-new-session',
      method: 'new',
      restoreError: 'first session could not be restored'
    })
    expect(manager.acpSessionRestoreNotice.value).not.toBeNull()

    const documentScopeId = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/reopened-twice.fig'),
      'ai-doc-reopened-twice'
    )
    const scope = await sessionScope(documentScopeId, role)
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(scope))?.sessionId ?? null,
      'second-new-session'
    )
    await manager.resetChat()
  })

  test('ignores a restore callback after the user switches documents', async () => {
    const sessionStore = createMemoryAISessionStore()
    const role = resolvedRole()
    const storeA = editorStore('/tmp/deferred-a.fig')
    const storeB = editorStore('/tmp/deferred-b.fig')
    let activeStore = storeA
    const callbacks: Array<(event: ACPSessionOpenedEvent) => void> = []
    const factory: CreateACPTransportFactory = async (_providerId, optionsOrCallback) => {
      const transportOptions: CreateACPTransportOptions =
        typeof optionsOrCallback === 'function'
          ? { onConfigOptionsChange: optionsOrCallback }
          : (optionsOrCallback ?? {})
      if (transportOptions.onSessionOpened) callbacks.push(transportOptions.onSessionOpened)
      return {
        async connect() {
          return undefined
        },
        async destroy() {
          return undefined
        },
        async setSessionConfigOption() {
          return undefined
        },
        async sendMessages() {
          return new ReadableStream<UIMessageChunk>({
            start(controller) {
              controller.close()
            }
          })
        },
        async reconnectToStream() {
          return null
        }
      }
    }
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => true),
      providerID: ref(role.connection.providerID),
      credentialsReady: Promise.resolve(),
      getActiveEditorStore: () => activeStore,
      createACPTransportFactory: factory,
      acpSessionStore: sessionStore,
      resolveACPModelRole: () => role
    })
    await manager.ensureChat()
    activeStore = storeB
    callbacks[0]?.({
      sessionId: 'wrong-document-session',
      method: 'new',
      restoreError: 'deferred restore failure'
    })

    expect(manager.acpSessionRestoreNotice.value).toBeNull()
    await manager.resetChat()
  })

  test('never reads ACP persistence for a direct provider', async () => {
    const sessionStore = createMemoryAISessionStore()
    const resolveScope = vi.spyOn(sessionStore, 'resolveDocumentScopeId')
    const readSession = vi.spyOn(sessionStore, 'readACPSession')
    const writeSession = vi.spyOn(sessionStore, 'writeACPSession')
    const deleteSession = vi.spyOn(sessionStore, 'deleteACPSession')
    const store = editorStore('/tmp/direct.fig')
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => false),
      providerID: ref<AIProviderID>('openai'),
      credentialsReady: Promise.resolve(),
      getActiveEditorStore: () => store,
      acpSessionStore: sessionStore,
      resolveACPModelRole: () => resolvedRole('acp:codex')
    })
    manager.setOverrideTransport(() => ({
      async sendMessages() {
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.close()
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }))

    await manager.ensureChat()
    expect(resolveScope).not.toHaveBeenCalled()
    expect(readSession).not.toHaveBeenCalled()
    await manager.resetChat()
    expect(writeSession).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
  })

  test('loads supported ACP session history and reports inline list errors', async () => {
    const role = resolvedRole()
    const store = editorStore('/tmp/history.fig')
    const sessions: ACPSessionListItem[] = [
      {
        sessionId: 'history-one',
        cwd: '/tmp',
        title: 'First session',
        updatedAt: '2026-08-03T08:00:00.000Z'
      }
    ]
    const records: PlannedTransportRecord[] = []
    const manager = createPlannedManager({
      getStore: () => store,
      role,
      records,
      plans: [{ listSessions: async () => sessions }]
    })

    await manager.ensureChat()
    await manager.refreshACPSessionHistory()
    expect(manager.acpSessionHistory.value).toEqual({
      state: 'ready',
      sessions: sessions.map((session) => ({ ...session, match: 'unverified' })),
      error: null
    })

    records[0].transport.listSessions = async () => {
      throw new Error('history service unavailable')
    }
    await manager.refreshACPSessionHistory()
    expect(manager.acpSessionHistory.value).toEqual({
      state: 'error',
      sessions: [],
      error: 'history service unavailable'
    })
    await manager.resetChat()
  })

  test('identifies exact, same-document, and unverified history without trusting titles or cwd', async () => {
    const role = resolvedRole()
    const otherProfileRole = resolvedRole('acp:codex', 'model-codex-other')
    const store = editorStore('/tmp/identified-history.fig')
    const sessionStore = createMemoryAISessionStore()
    const documentScopeId = 'ai-doc-identified-history' as AIDocumentScopeId
    await sessionStore.bindDocumentAlias(
      pathDocumentAlias('/tmp/identified-history.fig'),
      documentScopeId
    )
    const exactScope = await sessionScope(documentScopeId, role)
    const sameDocumentScope = await sessionScope(documentScopeId, otherProfileRole)
    await sessionStore.writeACPSession(exactScope, 'exact-history')
    await sessionStore.writeACPSession(sameDocumentScope, 'same-document-history')

    const sharedMetadata = {
      cwd: '/Users/example',
      title: 'You are a design assistant inside a vector design editor.',
      updatedAt: '2026-08-03T08:00:00.000Z'
    }
    const sessions: ACPSessionListItem[] = [
      { sessionId: 'exact-history', ...sharedMetadata },
      { sessionId: 'same-document-history', ...sharedMetadata },
      { sessionId: 'unknown-history', ...sharedMetadata }
    ]
    const records: PlannedTransportRecord[] = []
    const manager = createPlannedManager({
      getStore: () => store,
      role,
      records,
      sessionStore,
      plans: [{ listSessions: async () => sessions }]
    })

    await manager.ensureChat()
    await manager.refreshACPSessionHistory()
    expect(manager.acpSessionHistory.value).toEqual({
      state: 'ready',
      sessions: [
        { ...sessions[0], match: 'exact' },
        { ...sessions[1], match: 'same-document' },
        { ...sessions[2], match: 'unverified' }
      ],
      error: null
    })
    await manager.resetChat()
  })

  test('does not mark a new session exact until its first prompt succeeds', async () => {
    const role = resolvedRole()
    const store = editorStore('/tmp/history-first-prompt.fig')
    const baseSessionStore = createMemoryAISessionStore()
    const listStarted = deferred()
    const allowList = deferred()
    let pauseList = false
    const sessionStore: AISessionStore = {
      ...baseSessionStore,
      async listACPSessionsForDocument(...args) {
        if (pauseList) {
          listStarted.resolve()
          await allowList.promise
        }
        return baseSessionStore.listACPSessionsForDocument(...args)
      }
    }
    const currentSession: ACPSessionListItem = {
      sessionId: 'planned-session-1',
      cwd: '/Users/example',
      title: 'Repeated agent title',
      updatedAt: null
    }
    const records: PlannedTransportRecord[] = []
    const manager = createPlannedManager({
      getStore: () => store,
      role,
      records,
      sessionStore,
      plans: [{ listSessions: async () => [currentSession] }]
    })

    const chat = await manager.ensureChat()
    if (!chat) throw new Error('Missing chat')
    await manager.refreshACPSessionHistory()
    expect(manager.acpSessionHistory.value.sessions[0]?.match).toBe('unverified')

    pauseList = true
    const refreshing = manager.refreshACPSessionHistory()
    await listStarted.promise
    await chat.sendMessage({ text: 'commit this session' })
    allowList.resolve()
    await refreshing
    expect(manager.acpSessionHistory.value.sessions[0]?.match).toBe('exact')
    await manager.resetChat()
  })

  test('reports unsupported history when a managed transport lacks listSessions', async () => {
    const role = resolvedRole()
    const store = editorStore('/tmp/history-unsupported.fig')
    const starts: TransportStart[] = []
    const manager = createPersistentManager({
      store,
      role,
      sessionStore: createMemoryAISessionStore(),
      starts
    })

    await manager.ensureChat()
    await manager.refreshACPSessionHistory()
    expect(manager.acpSessionHistory.value).toEqual({
      state: 'unsupported',
      sessions: [],
      error: null
    })
    await manager.resetChat()
  })

  test('ignores a stale history response after the active tab invalidates its transport', async () => {
    const role = resolvedRole()
    const storeA = editorStore('/tmp/history-stale-a.fig')
    const storeB = editorStore('/tmp/history-stale-b.fig')
    let activeStore = storeA
    const listGate = deferred()
    const records: PlannedTransportRecord[] = []
    const manager = createPlannedManager({
      getStore: () => activeStore,
      role,
      records,
      plans: [
        {
          listSessions: async () => {
            await listGate.promise
            return [
              {
                sessionId: 'stale-history',
                cwd: '/tmp',
                title: null,
                updatedAt: null
              }
            ]
          }
        }
      ]
    })

    await manager.ensureChat()
    const refreshing = manager.refreshACPSessionHistory()
    await waitForCondition(
      () => manager.acpSessionHistory.value.state === 'loading',
      'History did not enter loading state'
    )
    activeStore = storeB
    manager.markTransportDirty()
    listGate.resolve()
    await refreshing
    expect(manager.acpSessionHistory.value).toEqual({
      state: 'idle',
      sessions: [],
      error: null
    })
    await manager.resetChat()
  })

  test('ignores history identification that finishes after the active tab changes', async () => {
    const role = resolvedRole()
    const storeA = editorStore('/tmp/history-local-stale-a.fig')
    const storeB = editorStore('/tmp/history-local-stale-b.fig')
    let activeStore = storeA
    const baseSessionStore = createMemoryAISessionStore()
    const listStarted = deferred()
    const allowList = deferred()
    const sessionStore: AISessionStore = {
      ...baseSessionStore,
      async listACPSessionsForDocument(...args) {
        listStarted.resolve()
        await allowList.promise
        return baseSessionStore.listACPSessionsForDocument(...args)
      }
    }
    const records: PlannedTransportRecord[] = []
    const manager = createPlannedManager({
      getStore: () => activeStore,
      role,
      records,
      sessionStore,
      plans: [
        {
          listSessions: async () => [
            {
              sessionId: 'local-stale-history',
              cwd: '/tmp',
              title: null,
              updatedAt: null
            }
          ]
        }
      ]
    })

    await manager.ensureChat()
    const refreshing = manager.refreshACPSessionHistory()
    await listStarted.promise
    activeStore = storeB
    manager.markTransportDirty()
    allowList.resolve()
    await refreshing
    expect(manager.acpSessionHistory.value).toEqual({
      state: 'idle',
      sessions: [],
      error: null
    })
    await manager.resetChat()
  })

  test('rejects unknown and already-active IDs from manual session restore', async () => {
    const role = resolvedRole()
    const store = editorStore('/tmp/history-unknown.fig')
    const records: PlannedTransportRecord[] = []
    const activeSession: ACPSessionListItem = {
      sessionId: 'planned-session-1',
      cwd: '/tmp',
      title: null,
      updatedAt: null
    }
    const manager = createPlannedManager({
      getStore: () => store,
      role,
      records,
      plans: [{ listSessions: async () => [activeSession] }]
    })

    await manager.ensureChat()
    await manager.refreshACPSessionHistory()
    await expect(manager.restoreACPSession('not-listed')).rejects.toThrow(
      'latest loaded ACP session history'
    )
    await expect(manager.restoreACPSession(activeSession.sessionId)).rejects.toThrow(
      'already active'
    )
    expect(records).toHaveLength(1)
    await manager.resetChat()
  })

  test('atomically swaps a manually resumed session and persists it only after its first prompt', async () => {
    const role = resolvedRole()
    const store = editorStore('/tmp/manual-resume.fig')
    const sessionStore = createMemoryAISessionStore()
    const candidateGate = deferred()
    const selected: ACPSessionListItem = {
      sessionId: 'selected-history-session',
      cwd: '/tmp',
      title: 'Selected session',
      updatedAt: '2026-08-03T09:00:00.000Z'
    }
    const records: PlannedTransportRecord[] = []
    const manager = createPlannedManager({
      getStore: () => store,
      role,
      records,
      sessionStore,
      plans: [
        {
          setup: {
            sessionId: 'active-session',
            method: 'new',
            capabilities: { ...SESSION_CAPABILITIES }
          },
          listSessions: async () => [selected]
        },
        {
          setup: {
            sessionId: selected.sessionId,
            method: 'resume',
            capabilities: { ...SESSION_CAPABILITIES }
          },
          connectGate: candidateGate.promise
        }
      ]
    })

    const oldChat = await sendPrompt(manager, 'active transcript')
    const documentScopeId = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/manual-resume.fig'),
      'ai-doc-manual-resume'
    )
    const scope = await sessionScope(documentScopeId, role)
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(scope))?.sessionId ?? null,
      'active-session'
    )
    await manager.refreshACPSessionHistory()

    const restoring = manager.restoreACPSession(selected.sessionId)
    await waitForCondition(() => records.length === 2, 'Candidate transport was not created')
    expect(records[1].options.resumeFallback).toBe('error')
    expect(await manager.ensureChat()).toBe(oldChat)
    expect(manager.acpSessionStatus.value).toMatchObject({
      state: 'connecting',
      sessionId: 'active-session',
      requestedSessionId: selected.sessionId,
      source: 'manual'
    })
    expect((await sessionStore.readACPSession(scope))?.sessionId).toBe('active-session')

    candidateGate.resolve()
    await restoring
    const replacementChat = await manager.ensureChat()
    if (!replacementChat) throw new Error('Missing manually restored chat')
    expect(replacementChat).not.toBe(oldChat)
    expect(replacementChat.messages).toEqual([])
    expect(manager.acpSessionStatus.value).toMatchObject({
      state: 'resumed',
      sessionId: selected.sessionId,
      requestedSessionId: selected.sessionId,
      source: 'manual',
      error: null
    })
    expect((await sessionStore.readACPSession(scope))?.sessionId).toBe('active-session')

    await replacementChat.sendMessage({ text: 'continue selected session' })
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(scope))?.sessionId ?? null,
      selected.sessionId
    )
    await manager.resetChat()
  })

  test('does not persist an unverified manual candidate when an unsaved document is first saved', async () => {
    const role = resolvedRole()
    const document = mutableEditorStore(null)
    const sessionStore = createMemoryAISessionStore()
    const selected: ACPSessionListItem = {
      sessionId: 'unsaved-selected-session',
      cwd: '/tmp',
      title: null,
      updatedAt: null
    }
    const records: PlannedTransportRecord[] = []
    const manager = createPlannedManager({
      getStore: () => document.store,
      role,
      records,
      sessionStore,
      plans: [
        { listSessions: async () => [selected] },
        {
          setup: {
            sessionId: selected.sessionId,
            method: 'resume',
            capabilities: { ...SESSION_CAPABILITIES }
          }
        }
      ]
    })

    await manager.ensureChat()
    await manager.refreshACPSessionHistory()
    await manager.restoreACPSession(selected.sessionId)
    const replacementChat = await manager.ensureChat()
    if (!replacementChat) throw new Error('Missing manually restored unsaved chat')

    document.setPath('/tmp/manual-first-save.fig')
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    const documentScopeId = await sessionStore.resolveDocumentScopeId(
      pathDocumentAlias('/tmp/manual-first-save.fig'),
      'ai-doc-manual-first-save'
    )
    const scope = await sessionScope(documentScopeId, role)
    expect(await sessionStore.readACPSession(scope)).toBeNull()

    await replacementChat.sendMessage({ text: 'verify selected session' })
    await waitForStoredSession(
      async () => (await sessionStore.readACPSession(scope))?.sessionId ?? null,
      selected.sessionId
    )
    await manager.resetChat()
  })

  test('keeps the old Chat and binding when manual resume fails', async () => {
    const role = resolvedRole()
    const store = editorStore('/tmp/manual-resume-failure.fig')
    const selected: ACPSessionListItem = {
      sessionId: 'broken-history-session',
      cwd: '/tmp',
      title: null,
      updatedAt: null
    }
    const records: PlannedTransportRecord[] = []
    const manager = createPlannedManager({
      getStore: () => store,
      role,
      records,
      plans: [
        { listSessions: async () => [selected] },
        { connectError: new Error('resume rejected') }
      ]
    })
    const oldChat = await sendPrompt(manager, 'keep this transcript')
    const oldMessages = oldChat.messages
    await manager.refreshACPSessionHistory()

    await expect(manager.restoreACPSession(selected.sessionId)).rejects.toThrow('resume rejected')
    expect(await manager.ensureChat()).toBe(oldChat)
    expect(oldChat.messages).toEqual(oldMessages)
    expect(records[1].destroyed).toBeTrue()
    expect(manager.acpSessionStatus.value).toMatchObject({
      state: 'new',
      sessionId: 'planned-session-1',
      requestedSessionId: selected.sessionId,
      source: 'manual',
      error: 'resume rejected'
    })
    await oldChat.sendMessage({ text: 'continue the unchanged active session' })
    expect(oldChat.status).toBe('ready')
    await manager.resetChat()
  })

  test('never accepts a new-session fallback during manual restore', async () => {
    const role = resolvedRole()
    const store = editorStore('/tmp/manual-no-fallback.fig')
    const selected: ACPSessionListItem = {
      sessionId: 'strict-history-session',
      cwd: '/tmp',
      title: null,
      updatedAt: null
    }
    const records: PlannedTransportRecord[] = []
    const manager = createPlannedManager({
      getStore: () => store,
      role,
      records,
      plans: [
        { listSessions: async () => [selected] },
        {
          setup: {
            sessionId: 'unexpected-new-session',
            method: 'new',
            restoreError: 'resume unavailable',
            capabilities: { ...SESSION_CAPABILITIES }
          }
        }
      ]
    })
    const oldChat = await manager.ensureChat()
    if (!oldChat) throw new Error('Missing active chat')
    await manager.refreshACPSessionHistory()

    await expect(manager.restoreACPSession(selected.sessionId)).rejects.toThrow(
      'did not resume the requested session'
    )
    expect(records[1].options.resumeFallback).toBe('error')
    expect(records[1].destroyed).toBeTrue()
    expect(await manager.ensureChat()).toBe(oldChat)
    expect(manager.acpSessionStatus.value).toMatchObject({
      state: 'new',
      sessionId: 'planned-session-1',
      requestedSessionId: selected.sessionId,
      source: 'manual',
      error: 'The ACP agent did not resume the requested session.'
    })
    await manager.resetChat()
  })
})
