import { ACP_AGENTS } from '@open-pencil/core/constants'

import { AI_MODEL_ROLES } from '@/app/ai/models/types'
import { createIdbAISessionBackend } from '@/app/ai/sessions/idb'
import { createMemoryAISessionBackend } from '@/app/ai/sessions/memory'
import {
  AI_SESSION_GLOBAL_LIMIT,
  AI_SESSION_PER_DOCUMENT_LIMIT,
  AI_SESSION_SCHEMA_VERSION,
  AI_SESSION_TTL_MS,
  type ACPSessionScope,
  type AIDocumentAlias,
  type AIDocumentScopeId,
  type AISessionCleanupResult,
  type AISessionStorageBackend,
  type AISessionStore,
  type StoredACPSessionV1,
  type StoredAIDocumentAliasV1
} from '@/app/ai/sessions/types'

const MAX_PATH_LENGTH = 32_768
const MAX_SEGMENT_LENGTH = 512
const MAX_CONTEXT_VERSION_LENGTH = 128
const MAX_SESSION_ID_LENGTH = 8_192

type UnknownRecord = { [key: string]: unknown }

function objectRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, name: string, maxLength = MAX_SEGMENT_LENGTH): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${name} must be a non-empty string of at most ${maxLength} characters.`)
  }
  return value
}

function validString(value: unknown, maxLength = MAX_SEGMENT_LENGTH): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= maxLength
}

function timestamp(value: number | undefined): number {
  const result = value ?? Date.now()
  if (!Number.isFinite(result) || result < 0) throw new TypeError('now must be a finite timestamp.')
  return result
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function createDocumentScopeId(): AIDocumentScopeId {
  const runtimeCrypto: Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto
  if (typeof runtimeCrypto.randomUUID !== 'function') {
    throw new TypeError('Secure random document identifiers are unavailable in this runtime.')
  }
  return `ai-doc-${runtimeCrypto.randomUUID()}`
}

export function assertDocumentScopeId(value: string): asserts value is AIDocumentScopeId {
  if (!value.startsWith('ai-doc-') || !validString(value)) {
    throw new TypeError('documentScopeId must be a non-empty ai-doc-* identifier.')
  }
}

export function pathDocumentAlias(path: string): AIDocumentAlias {
  requiredString(path, 'path', MAX_PATH_LENGTH)
  return { kind: 'path', path }
}

export function storageDocumentAlias(providerId: string, documentId: string): AIDocumentAlias {
  requiredString(providerId, 'providerId')
  requiredString(documentId, 'documentId')
  return { kind: 'storage', providerId, documentId }
}

function validatedAlias(alias: AIDocumentAlias): AIDocumentAlias {
  if (alias.kind === 'path') return pathDocumentAlias(alias.path)
  return storageDocumentAlias(alias.providerId, alias.documentId)
}

/** Stable, collision-safe serialized key for a local path or storage binding. */
export function documentAliasKey(alias: AIDocumentAlias): string {
  const valid = validatedAlias(alias)
  return valid.kind === 'path'
    ? `ai-document:${JSON.stringify(['path', valid.path])}`
    : `ai-document:${JSON.stringify(['storage', valid.providerId, valid.documentId])}`
}

function validatedScope(scope: ACPSessionScope): ACPSessionScope {
  assertDocumentScopeId(scope.documentScopeId)
  if (!AI_MODEL_ROLES.includes(scope.role)) throw new TypeError('Unknown AI model role.')
  if (!ACP_AGENTS.some((agent) => agent.id === scope.agentId)) {
    throw new TypeError('Unknown ACP agent.')
  }
  if (scope.providerId !== `acp:${scope.agentId}`) {
    throw new TypeError('ACP providerId and agentId must identify the same agent.')
  }
  requiredString(scope.connectionId, 'connectionId')
  requiredString(scope.modelProfileId, 'modelProfileId')
  if (!scope.modelProfileId.startsWith('model-')) {
    throw new TypeError('modelProfileId must be a model-* identifier.')
  }
  requiredString(scope.modelConfigurationId, 'modelConfigurationId')
  requiredString(scope.credentialProfileId, 'credentialProfileId')
  requiredString(scope.contextVersion, 'contextVersion', MAX_CONTEXT_VERSION_LENGTH)
  return { ...scope }
}

/** Composite key that isolates documents, roles, providers, agents, profiles, and context versions. */
export function acpSessionScopeKey(scope: ACPSessionScope): string {
  const valid = validatedScope(scope)
  return `acp-session:${JSON.stringify([
    valid.documentScopeId,
    valid.role,
    valid.providerId,
    valid.agentId,
    valid.connectionId,
    valid.modelProfileId,
    valid.modelConfigurationId,
    valid.credentialProfileId,
    valid.contextVersion
  ])}`
}

function parseAlias(value: unknown): AIDocumentAlias | null {
  if (!objectRecord(value) || (value.kind !== 'path' && value.kind !== 'storage')) return null
  const record = value
  if (record.kind === 'path') {
    return validString(record.path, MAX_PATH_LENGTH) ? { kind: 'path', path: record.path } : null
  }
  return validString(record.providerId) && validString(record.documentId)
    ? { kind: 'storage', providerId: record.providerId, documentId: record.documentId }
    : null
}

function parseDocumentScopeId(value: unknown): AIDocumentScopeId | null {
  return validString(value) && value.startsWith('ai-doc-') ? (value as AIDocumentScopeId) : null
}

function parseStoredAlias(value: unknown): StoredAIDocumentAliasV1 | null {
  if (!objectRecord(value) || value.schemaVersion !== AI_SESSION_SCHEMA_VERSION) return null
  const record = value
  const alias = parseAlias(record.alias)
  const documentScopeId = parseDocumentScopeId(record.documentScopeId)
  if (
    !alias ||
    !documentScopeId ||
    !validString(record.aliasKey) ||
    !validTimestamp(record.updatedAt)
  ) {
    return null
  }
  if (documentAliasKey(alias) !== record.aliasKey) return null
  return {
    schemaVersion: AI_SESSION_SCHEMA_VERSION,
    aliasKey: record.aliasKey,
    alias,
    documentScopeId,
    updatedAt: record.updatedAt
  }
}

function parseStoredScope(record: UnknownRecord): ACPSessionScope | null {
  const documentScopeId = parseDocumentScopeId(record.documentScopeId)
  if (!documentScopeId) return null
  const candidate = {
    documentScopeId,
    role: record.role,
    providerId: record.providerId,
    agentId: record.agentId,
    connectionId: record.connectionId,
    modelProfileId: record.modelProfileId,
    modelConfigurationId: record.modelConfigurationId,
    credentialProfileId: record.credentialProfileId,
    contextVersion: record.contextVersion
  }
  try {
    return validatedScope(candidate as ACPSessionScope)
  } catch {
    return null
  }
}

function parseStoredSession(value: unknown): StoredACPSessionV1 | null {
  if (!objectRecord(value) || value.schemaVersion !== AI_SESSION_SCHEMA_VERSION) return null
  const record = value
  const scope = parseStoredScope(record)
  if (
    !scope ||
    !validString(record.sessionKey, MAX_SESSION_ID_LENGTH) ||
    !validString(record.sessionId, MAX_SESSION_ID_LENGTH) ||
    !validTimestamp(record.createdAt) ||
    !validTimestamp(record.updatedAt) ||
    !(record.lastResumedAt === null || validTimestamp(record.lastResumedAt))
  ) {
    return null
  }
  if (acpSessionScopeKey(scope) !== record.sessionKey) return null
  return {
    schemaVersion: AI_SESSION_SCHEMA_VERSION,
    sessionKey: record.sessionKey,
    ...scope,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastResumedAt: record.lastResumedAt
  }
}

function isExpired(updatedAt: number, now: number): boolean {
  return now - updatedAt > AI_SESSION_TTL_MS
}

function futureSchema(value: unknown): boolean {
  const version = objectRecord(value) ? value.schemaVersion : undefined
  return typeof version === 'number' && version > AI_SESSION_SCHEMA_VERSION
}

export function createAISessionStore(backend: AISessionStorageBackend): AISessionStore {
  async function cleanup(now = Date.now()): Promise<AISessionCleanupResult> {
    const currentTime = timestamp(now)
    const storedSessions = await backend.listSessions()
    const validSessions = storedSessions
      .map(parseStoredSession)
      .filter((session): session is StoredACPSessionV1 => session !== null)
      .sort(
        (first, second) =>
          second.updatedAt - first.updatedAt ||
          second.createdAt - first.createdAt ||
          first.sessionKey.localeCompare(second.sessionKey)
      )

    const deleteKeys = new Set<string>()
    const perDocument = new Map<AIDocumentScopeId, number>()
    for (const session of validSessions) {
      if (isExpired(session.updatedAt, currentTime)) {
        deleteKeys.add(session.sessionKey)
        continue
      }
      const count = perDocument.get(session.documentScopeId) ?? 0
      if (count >= AI_SESSION_PER_DOCUMENT_LIMIT) {
        deleteKeys.add(session.sessionKey)
        continue
      }
      perDocument.set(session.documentScopeId, count + 1)
    }

    const retained = validSessions.filter((session) => !deleteKeys.has(session.sessionKey))
    for (const session of retained.slice(AI_SESSION_GLOBAL_LIMIT)) {
      deleteKeys.add(session.sessionKey)
    }
    await backend.deleteSessions([...deleteKeys])

    const retainedDocumentIds = new Set(
      retained
        .filter((session) => !deleteKeys.has(session.sessionKey))
        .map((session) => session.documentScopeId)
    )
    const deleteAliases: string[] = []
    for (const rawAlias of await backend.listAliases()) {
      const alias = parseStoredAlias(rawAlias)
      if (
        alias &&
        !retainedDocumentIds.has(alias.documentScopeId) &&
        isExpired(alias.updatedAt, currentTime)
      ) {
        deleteAliases.push(alias.aliasKey)
      }
    }
    await Promise.all(deleteAliases.map((key) => backend.deleteAlias(key)))
    return { deletedSessions: deleteKeys.size, deletedAliases: deleteAliases.length }
  }

  return {
    async resolveDocumentScopeId(alias, preferredDocumentScopeId, now = Date.now()) {
      assertDocumentScopeId(preferredDocumentScopeId)
      const currentTime = timestamp(now)
      if (!alias) return preferredDocumentScopeId
      const normalizedAlias = validatedAlias(alias)
      const candidate: StoredAIDocumentAliasV1 = {
        schemaVersion: AI_SESSION_SCHEMA_VERSION,
        aliasKey: documentAliasKey(normalizedAlias),
        alias: normalizedAlias,
        documentScopeId: preferredDocumentScopeId,
        updatedAt: currentTime
      }
      const raw = await backend.resolveAlias(candidate)
      const stored = parseStoredAlias(raw)
      if (stored) {
        await backend.putAlias({ ...stored, updatedAt: currentTime })
        return stored.documentScopeId
      }
      // A downgraded app must neither resume nor overwrite a future schema.
      if (!futureSchema(raw)) await backend.putAlias(candidate)
      return preferredDocumentScopeId
    },

    async bindDocumentAlias(alias, documentScopeId, now = Date.now()) {
      assertDocumentScopeId(documentScopeId)
      const normalizedAlias = validatedAlias(alias)
      const aliasKey = documentAliasKey(normalizedAlias)
      const existing = await backend.getAlias(aliasKey)
      if (futureSchema(existing)) return
      await backend.putAlias({
        schemaVersion: AI_SESSION_SCHEMA_VERSION,
        aliasKey,
        alias: normalizedAlias,
        documentScopeId,
        updatedAt: timestamp(now)
      })
    },

    async deleteDocumentAlias(alias) {
      await backend.deleteAlias(documentAliasKey(alias))
    },

    async readACPSession(scope, now = Date.now()) {
      const sessionKey = acpSessionScopeKey(scope)
      const raw = await backend.getSession(sessionKey)
      const session = parseStoredSession(raw)
      if (!session) return null
      if (isExpired(session.updatedAt, timestamp(now))) {
        await backend.deleteSession(sessionKey)
        return null
      }
      return session
    },

    async listACPSessionsForDocument(documentScopeId, now = Date.now()) {
      assertDocumentScopeId(documentScopeId)
      const currentTime = timestamp(now)
      return (await backend.listSessions())
        .map(parseStoredSession)
        .filter(
          (session): session is StoredACPSessionV1 =>
            session !== null &&
            session.documentScopeId === documentScopeId &&
            !isExpired(session.updatedAt, currentTime)
        )
        .sort(
          (first, second) =>
            second.updatedAt - first.updatedAt ||
            second.createdAt - first.createdAt ||
            first.sessionKey.localeCompare(second.sessionKey)
        )
    },

    async writeACPSession(scope, sessionId, options = {}) {
      const validScope = validatedScope(scope)
      requiredString(sessionId, 'sessionId', MAX_SESSION_ID_LENGTH)
      const currentTime = timestamp(options.now)
      const sessionKey = acpSessionScopeKey(validScope)
      const rawExisting = await backend.getSession(sessionKey)
      if (futureSchema(rawExisting)) {
        throw new Error('Cannot overwrite an ACP session created by a newer OpenPencil version.')
      }
      const existing = parseStoredSession(rawExisting)
      const sameRemoteSession = existing?.sessionId === sessionId ? existing : null
      let lastResumedAt = sameRemoteSession?.lastResumedAt ?? null
      if (options.resumed) lastResumedAt = currentTime
      const record: StoredACPSessionV1 = {
        schemaVersion: AI_SESSION_SCHEMA_VERSION,
        sessionKey,
        ...validScope,
        sessionId,
        createdAt: sameRemoteSession?.createdAt ?? currentTime,
        updatedAt: currentTime,
        lastResumedAt
      }
      await backend.putSession(record)
      await cleanup(currentTime)
      return record
    },

    async deleteACPSession(scope) {
      await backend.deleteSession(acpSessionScopeKey(scope))
    },

    cleanup
  }
}

export function createFallbackBackend(
  primary: AISessionStorageBackend,
  fallback: AISessionStorageBackend
): AISessionStorageBackend {
  let primaryFailed = false
  let primaryFailure: unknown
  let warned = false

  function markPrimaryFailed(error: unknown): void {
    primaryFailed = true
    primaryFailure = error
    if (!warned) {
      warned = true
      console.warn('[AI sessions] IndexedDB unavailable, using memory:', error)
    }
  }

  async function run<T>(primaryTask: () => Promise<T>, fallbackTask: () => Promise<T>): Promise<T> {
    if (!primaryFailed) {
      try {
        return await primaryTask()
      } catch (error) {
        markPrimaryFailed(error)
      }
    }
    return fallbackTask()
  }

  async function runDelete(
    primaryTask: () => Promise<void>,
    fallbackTask: () => Promise<void>
  ): Promise<void> {
    if (!primaryFailed) {
      try {
        await primaryTask()
        return
      } catch (error) {
        markPrimaryFailed(error)
      }
    }

    try {
      await fallbackTask()
    } catch (fallbackError) {
      throw new AggregateError(
        [primaryFailure, fallbackError],
        'Failed to delete the persistent and in-memory AI session data.'
      )
    }
    throw primaryFailure
  }

  return {
    resolveAlias: (candidate) =>
      run(
        () => primary.resolveAlias(candidate),
        () => fallback.resolveAlias(candidate)
      ),
    getAlias: (key) =>
      run(
        () => primary.getAlias(key),
        () => fallback.getAlias(key)
      ),
    putAlias: (record) =>
      run(
        () => primary.putAlias(record),
        () => fallback.putAlias(record)
      ),
    deleteAlias: (key) =>
      runDelete(
        () => primary.deleteAlias(key),
        () => fallback.deleteAlias(key)
      ),
    listAliases: () =>
      run(
        () => primary.listAliases(),
        () => fallback.listAliases()
      ),
    getSession: (key) =>
      run(
        () => primary.getSession(key),
        () => fallback.getSession(key)
      ),
    putSession: (record) =>
      run(
        () => primary.putSession(record),
        () => fallback.putSession(record)
      ),
    deleteSession: (key) =>
      runDelete(
        () => primary.deleteSession(key),
        () => fallback.deleteSession(key)
      ),
    listSessions: () =>
      run(
        () => primary.listSessions(),
        () => fallback.listSessions()
      ),
    deleteSessions: (keys) =>
      keys.length === 0
        ? Promise.resolve()
        : runDelete(
            () => primary.deleteSessions(keys),
            () => fallback.deleteSessions(keys)
          )
  }
}

export function createMemoryAISessionStore(): AISessionStore {
  return createAISessionStore(createMemoryAISessionBackend())
}

export function createIdbAISessionStore(databaseName?: string): AISessionStore {
  return createAISessionStore(
    createFallbackBackend(createIdbAISessionBackend(databaseName), createMemoryAISessionBackend())
  )
}

let singleton: AISessionStore | null = null

export function resetAISessionStoreForTests(store?: AISessionStore): void {
  singleton = store ?? null
}

export function getAISessionStore(): AISessionStore {
  if (singleton) return singleton
  singleton =
    typeof indexedDB === 'undefined' ? createMemoryAISessionStore() : createIdbAISessionStore()
  return singleton
}
