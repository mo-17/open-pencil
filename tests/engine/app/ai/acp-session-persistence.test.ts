import 'fake-indexeddb/auto'
import { describe, expect, spyOn, test } from 'bun:test'

import type { AIProviderID } from '@open-pencil/core/constants'

import { createACPSessionPersistence } from '@/app/ai/chat/acp-session-persistence'
import type { ResolvedAIModelRole } from '@/app/ai/models'
import {
  AI_SESSION_GLOBAL_LIMIT,
  AI_SESSION_PER_DOCUMENT_LIMIT,
  AI_SESSION_SCHEMA_VERSION,
  AI_SESSION_TTL_MS,
  acpSessionScopeKey,
  createAISessionStore,
  documentAliasKey,
  createIdbAISessionStore,
  createMemoryAISessionBackend,
  createMemoryAISessionStore,
  pathDocumentAlias,
  storageDocumentAlias,
  type ACPSessionScope,
  type AIDocumentScopeId,
  type AISessionStore
} from '@/app/ai/sessions'
import { createFallbackBackend } from '@/app/ai/sessions/store'
import type { getActiveEditorStore } from '@/app/editor/active-store'

type EditorStore = ReturnType<typeof getActiveEditorStore>

function documentId(id: string): AIDocumentScopeId {
  return `ai-doc-${id}`
}

function scope(overrides: Partial<ACPSessionScope> = {}): ACPSessionScope {
  return {
    documentScopeId: documentId('document-1'),
    role: 'design',
    providerId: 'acp:codex',
    agentId: 'codex',
    connectionId: 'connection-codex',
    modelProfileId: 'model-codex',
    modelConfigurationId: 'configuration-codex',
    credentialProfileId: 'credential-codex',
    contextVersion: 'open-pencil-context-v1',
    ...overrides
  }
}

function resolvedRole(providerId: AIProviderID = 'acp:codex'): ResolvedAIModelRole {
  return {
    requestedRole: 'design',
    profile: {
      id: 'model-codex',
      name: 'Codex',
      connectionId: 'connection-codex',
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
      id: 'connection-codex',
      providerID: providerId,
      customBaseURL: '',
      customAPIType: 'responses',
      credentialProfileId: 'credential-codex'
    }
  }
}

function editorStore(path: string | null): EditorStore {
  return {
    getStorageBinding: () => null,
    getSourceIdentity: () => ({ handle: null, path })
  } as EditorStore
}

describe('AI document session identity', () => {
  test('uses a caller-provided scope for unsaved documents and resolves stable aliases', async () => {
    const store = createMemoryAISessionStore()
    const first = documentId('first')
    const second = documentId('second')
    const path = pathDocumentAlias('/tmp/design.fig')
    const storage = storageDocumentAlias('s3-compatible', 'remote-1')

    expect(await store.resolveDocumentScopeId(null, first, 1)).toBe(first)
    expect(await store.resolveDocumentScopeId(path, first, 2)).toBe(first)
    expect(await store.resolveDocumentScopeId(path, second, 3)).toBe(first)
    expect(await store.resolveDocumentScopeId(storage, second, 4)).toBe(second)

    await store.bindDocumentAlias(path, second, 5)
    expect(await store.resolveDocumentScopeId(path, first, 6)).toBe(second)
    await store.deleteDocumentAlias(path)
    expect(await store.resolveDocumentScopeId(path, first, 7)).toBe(first)
  })

  test('scope keys isolate agents, roles, connections, configurations, and documents', () => {
    const base = acpSessionScopeKey(scope())
    const variants = [
      scope({ documentScopeId: documentId('document-2') }),
      scope({ role: 'review' }),
      scope({ connectionId: 'connection-codex-2' }),
      scope({ modelProfileId: 'model-codex-2' }),
      scope({ modelConfigurationId: 'configuration-codex-2' }),
      scope({ credentialProfileId: 'credential-codex-2' }),
      scope({ contextVersion: 'open-pencil-context-v2' }),
      scope({
        providerId: 'acp:claude-code',
        agentId: 'claude-code',
        connectionId: 'connection-claude',
        modelProfileId: 'model-claude'
      }),
      scope({
        providerId: 'acp:gemini-cli',
        agentId: 'gemini-cli',
        connectionId: 'connection-gemini',
        modelProfileId: 'model-gemini'
      })
    ]

    expect(new Set([base, ...variants.map(acpSessionScopeKey)]).size).toBe(variants.length + 1)
  })
})

describe('ACP session persistence', () => {
  test('lists only live sessions for one document in most-recent order', async () => {
    const store = createMemoryAISessionStore()
    const firstDocument = documentId('history-first')
    const secondDocument = documentId('history-second')
    const older = scope({
      documentScopeId: firstDocument,
      modelConfigurationId: 'configuration-older'
    })
    const newer = scope({
      documentScopeId: firstDocument,
      modelConfigurationId: 'configuration-newer'
    })
    const otherDocument = scope({ documentScopeId: secondDocument })

    await store.writeACPSession(older, 'older-session', { now: 100 })
    await store.writeACPSession(newer, 'newer-session', { now: 200 })
    await store.writeACPSession(otherDocument, 'other-document-session', { now: 300 })

    expect(
      (await store.listACPSessionsForDocument(firstDocument, 300)).map((record) => record.sessionId)
    ).toEqual(['newer-session', 'older-session'])
    expect(
      await store.listACPSessionsForDocument(firstDocument, 200 + AI_SESSION_TTL_MS + 1)
    ).toEqual([])
  })

  test('reports a failed durable remember write while keeping later writes queued', async () => {
    const failure = new Error('IndexedDB write failed')
    const baseStore = createMemoryAISessionStore()
    let writeAttempts = 0
    const sessionStore: AISessionStore = {
      ...baseStore,
      async writeACPSession(...args) {
        writeAttempts += 1
        if (writeAttempts === 1) throw failure
        return baseStore.writeACPSession(...args)
      }
    }
    const role = resolvedRole()
    const persistence = createACPSessionPersistence({
      sessionStore,
      resolveModelRole: () => role
    })
    const binding = await persistence.resolve(
      editorStore('/tmp/durability.fig'),
      role.connection.providerID
    )
    if (!binding) throw new Error('Expected a persistent ACP session binding')
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const failed = persistence.remember(binding, {
        sessionId: 'failed-session',
        method: 'new'
      })
      await expect(failed.durability).rejects.toBe(failure)

      const succeeded = persistence.remember(binding, {
        sessionId: 'next-session',
        method: 'new'
      })
      await expect(succeeded.durability).resolves.toBeUndefined()

      expect(writeAttempts).toBe(2)
      expect(await sessionStore.readACPSession(binding.scope)).toMatchObject({
        sessionId: 'next-session'
      })
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  test('writes, resumes, reads, and deletes a scoped session', async () => {
    const store = createMemoryAISessionStore()
    const target = scope()

    expect(await store.readACPSession(target, 10)).toBeNull()
    const created = await store.writeACPSession(target, 'session-1', { now: 10 })
    expect(created).toMatchObject({
      schemaVersion: AI_SESSION_SCHEMA_VERSION,
      sessionId: 'session-1',
      createdAt: 10,
      updatedAt: 10,
      lastResumedAt: null
    })

    const resumed = await store.writeACPSession(target, 'session-1', { now: 20, resumed: true })
    expect(resumed.createdAt).toBe(10)
    expect(resumed.updatedAt).toBe(20)
    expect(resumed.lastResumedAt).toBe(20)
    expect(await store.readACPSession(target, 21)).toEqual(resumed)

    const replaced = await store.writeACPSession(target, 'session-2', { now: 30 })
    expect(replaced.createdAt).toBe(30)
    expect(replaced.lastResumedAt).toBeNull()

    await store.deleteACPSession(target)
    expect(await store.readACPSession(target, 22)).toBeNull()
  })

  test('persists across independent IndexedDB store instances', async () => {
    const databaseName = `open-pencil-ai-sessions-test-${crypto.randomUUID()}`
    const first = createIdbAISessionStore(databaseName)
    const second = createIdbAISessionStore(databaseName)
    const target = scope({ documentScopeId: documentId('idb') })

    await first.writeACPSession(target, 'idb-session', { now: 100 })

    expect(await second.readACPSession(target, 101)).toMatchObject({
      sessionId: 'idb-session',
      documentScopeId: documentId('idb')
    })
  })

  test('fails closed for malformed and future-schema session and alias records', async () => {
    const backend = createMemoryAISessionBackend()
    const store = createAISessionStore(backend)
    const target = scope({ documentScopeId: documentId('future') })
    const sessionKey = acpSessionScopeKey(target)
    const futureSession = {
      schemaVersion: AI_SESSION_SCHEMA_VERSION + 1,
      sessionKey,
      ...target,
      sessionId: 'future-session',
      createdAt: 1,
      updatedAt: 1,
      lastResumedAt: null
    }
    await backend.putSession(futureSession)
    expect(await store.readACPSession(target, 2)).toBeNull()
    await expect(store.writeACPSession(target, 'downgraded-session', { now: 3 })).rejects.toThrow(
      'newer OpenPencil version'
    )
    expect(await backend.getSession(sessionKey)).toEqual(futureSession)

    await backend.putSession({
      ...futureSession,
      schemaVersion: AI_SESSION_SCHEMA_VERSION,
      sessionId: ''
    })
    expect(await store.readACPSession(target, 2)).toBeNull()

    const alias = pathDocumentAlias('/tmp/future.fig')
    const futureAlias = {
      schemaVersion: AI_SESSION_SCHEMA_VERSION + 1,
      aliasKey: `ai-document:${JSON.stringify(['path', '/tmp/future.fig'])}`,
      alias,
      documentScopeId: documentId('stored-future'),
      updatedAt: 1
    }
    await backend.putAlias(futureAlias)
    expect(await store.resolveDocumentScopeId(alias, documentId('preferred'), 2)).toBe(
      documentId('preferred')
    )
  })

  test('rejects failed persistent deletes after clearing the in-memory fallback', async () => {
    const failure = new Error('IndexedDB delete failed')
    const primary = createMemoryAISessionBackend()
    const fallback = createMemoryAISessionBackend()
    const target = scope({ documentScopeId: documentId('delete-failure') })
    const firstSessionKey = acpSessionScopeKey(target)
    const secondSessionKey = acpSessionScopeKey(
      scope({ documentScopeId: documentId('delete-failure-2') })
    )
    const alias = pathDocumentAlias('/tmp/delete-failure.fig')
    const aliasKey = documentAliasKey(alias)
    await fallback.putSession({ sessionKey: firstSessionKey })
    await fallback.putSession({ sessionKey: secondSessionKey })
    await fallback.putAlias({ aliasKey })

    const backend = createFallbackBackend(
      {
        ...primary,
        async deleteSession() {
          throw failure
        }
      },
      fallback
    )
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(backend.deleteSession(firstSessionKey)).rejects.toBe(failure)
      expect(await fallback.getSession(firstSessionKey)).toBeNull()

      await expect(backend.deleteAlias(aliasKey)).rejects.toBe(failure)
      expect(await fallback.getAlias(aliasKey)).toBeNull()

      await expect(backend.deleteSessions([secondSessionKey])).rejects.toBe(failure)
      expect(await fallback.getSession(secondSessionKey)).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  test('expires sessions after 90 days', async () => {
    const store = createMemoryAISessionStore()
    const target = scope({ documentScopeId: documentId('expired') })
    await store.writeACPSession(target, 'expired-session', { now: 0 })

    expect(await store.readACPSession(target, AI_SESSION_TTL_MS)).not.toBeNull()
    expect(await store.readACPSession(target, AI_SESSION_TTL_MS + 1)).toBeNull()
  })

  test('keeps only the eight most recent sessions per document', async () => {
    const backend = createMemoryAISessionBackend()
    const store = createAISessionStore(backend)
    const targetDocument = documentId('per-document-limit')

    for (let index = 0; index <= AI_SESSION_PER_DOCUMENT_LIMIT; index++) {
      await store.writeACPSession(
        scope({
          documentScopeId: targetDocument,
          modelProfileId: `model-${index}`,
          contextVersion: `context-${index}`
        }),
        `session-${index}`,
        { now: index + 1 }
      )
    }

    expect((await backend.listSessions()).length).toBe(AI_SESSION_PER_DOCUMENT_LIMIT)
    expect(
      await store.readACPSession(
        scope({
          documentScopeId: targetDocument,
          modelProfileId: 'model-0',
          contextVersion: 'context-0'
        }),
        20
      )
    ).toBeNull()
  })

  test('keeps only the 200 most recent sessions globally', async () => {
    const backend = createMemoryAISessionBackend()
    const store = createAISessionStore(backend)

    for (let index = 0; index <= AI_SESSION_GLOBAL_LIMIT; index++) {
      await store.writeACPSession(
        scope({
          documentScopeId: documentId(`global-${index}`),
          modelProfileId: `model-global-${index}`
        }),
        `session-global-${index}`,
        { now: index + 1 }
      )
    }

    expect((await backend.listSessions()).length).toBe(AI_SESSION_GLOBAL_LIMIT)
    expect(
      await store.readACPSession(
        scope({ documentScopeId: documentId('global-0'), modelProfileId: 'model-global-0' }),
        AI_SESSION_GLOBAL_LIMIT + 2
      )
    ).toBeNull()
  })
})
