import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import type { ACPSessionOpenedEvent } from '@/app/ai/acp/transport'
import type { ResolvedAIModelRole } from '@/app/ai/models'
import {
  acpSessionScopeKey,
  createDocumentScopeId,
  documentAliasKey,
  pathDocumentAlias,
  storageDocumentAlias
} from '@/app/ai/sessions'
import type {
  ACPSessionScope,
  AIDocumentAlias,
  AIDocumentScopeId,
  AISessionStore
} from '@/app/ai/sessions'
import type { getActiveEditorStore } from '@/app/editor/active-store'

type EditorStore = ReturnType<typeof getActiveEditorStore>

export const ACP_CHAT_CONTEXT_VERSION = 'open-pencil-ai-chat-v1'
const MAX_MODEL_CONFIGURATION_BYTES = 64 * 1024

export type ActiveACPSessionBinding = {
  store: EditorStore
  scope: ACPSessionScope
  sessionId: string | null
  persistent: boolean
  documentAliasKey: string | null
}

export type ACPSessionRememberResult = Readonly<{
  documentChanged: boolean
  restoreFailed: boolean
  durability: Promise<void>
}>

type ACPSessionPersistenceOptions = {
  sessionStore: AISessionStore
  resolveModelRole: () => ResolvedAIModelRole | null
  resolveConfigurationContext?: (role: ResolvedAIModelRole) => unknown
}

type DocumentIdentity = Readonly<{
  alias: AIDocumentAlias | null
  key: string | null
}>

type DocumentIdentityState = Readonly<{
  key: string | null
  documentScopeId: AIDocumentScopeId
}>

export type ACPDocumentIdentityTransition = 'unchanged' | 'preserved' | 'new-document'

function documentIdentity(store: EditorStore): DocumentIdentity {
  const binding = store.getStorageBinding()
  const alias = binding
    ? storageDocumentAlias(binding.providerId, binding.documentId)
    : (() => {
        const path = store.getSourceIdentity().path
        return path ? pathDocumentAlias(path) : null
      })()
  return { alias, key: alias ? documentAliasKey(alias) : null }
}

function canonicalValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('AI model configuration must be finite.')
    return value
  }
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, seen))
  if (typeof value !== 'object') {
    throw new TypeError('AI model configuration must be JSON-compatible.')
  }
  if (seen.has(value)) throw new TypeError('AI model configuration must not be cyclic.')
  seen.add(value)
  const result: Record<string, unknown> = {}
  const entries = Object.entries(value).sort(([first], [second]) => first.localeCompare(second))
  for (const [key, item] of entries) {
    if (item !== undefined) result[key] = canonicalValue(item, seen)
  }
  seen.delete(value)
  return result
}

/** Collision-resistant identity for every non-secret setting that changes an ACP runtime. */
export async function createACPModelConfigurationId(
  role: ResolvedAIModelRole,
  runtimeContext: unknown = null
): Promise<string> {
  const payload = canonicalValue({
    connection: {
      id: role.connection.id,
      providerId: role.connection.providerID,
      customBaseURL: role.connection.customBaseURL,
      customAPIType: role.connection.customAPIType,
      credentialProfileId: role.connection.credentialProfileId
    },
    profile: {
      id: role.profile.id,
      modelId: role.profile.modelID,
      customModelId: role.profile.customModelID,
      maxOutputTokens: role.profile.maxOutputTokens,
      capabilities: [...role.profile.capabilities].sort(),
      featurePolicy: {
        webSearch: role.profile.featurePolicy.webSearch.enabled,
        codeExecution: role.profile.featurePolicy.codeExecution.enabled,
        mcpServerIds: [...role.profile.featurePolicy.mcpServerIds].sort()
      }
    },
    runtimeContext
  })
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  if (bytes.byteLength > MAX_MODEL_CONFIGURATION_BYTES) {
    throw new TypeError('AI model configuration is too large to persist safely.')
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return `sha256-${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function createACPSessionPersistence(options: ACPSessionPersistenceOptions) {
  const documentIdentities = new WeakMap<EditorStore, DocumentIdentityState>()
  const liveSessionIds = new Map<string, string>()
  let queue: Promise<void> = Promise.resolve()

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const queued = queue.then(task)
    queue = queued
      .then(() => undefined)
      .catch((error) => {
        console.warn('[AI sessions] Failed to update the local ACP session binding:', error)
      })
    return queued
  }

  function bindIdentity(
    identity: DocumentIdentity,
    documentScopeId: AIDocumentScopeId
  ): Promise<void> {
    return identity.alias
      ? options.sessionStore.bindDocumentAlias(identity.alias, documentScopeId)
      : Promise.resolve()
  }

  function reconcileDocumentIdentity(
    binding: ActiveACPSessionBinding
  ): ACPDocumentIdentityTransition {
    const identity = documentIdentity(binding.store)
    if (identity.key === binding.documentAliasKey) return 'unchanged'

    if (binding.documentAliasKey === null && identity.key !== null) {
      binding.documentAliasKey = identity.key
      binding.persistent = true
      documentIdentities.set(binding.store, {
        key: identity.key,
        documentScopeId: binding.scope.documentScopeId
      })
      void enqueue(async () => {
        await bindIdentity(identity, binding.scope.documentScopeId)
        if (binding.sessionId) {
          await options.sessionStore.writeACPSession(binding.scope, binding.sessionId)
        }
      })
      return 'preserved'
    }

    const documentScopeId = createDocumentScopeId()
    documentIdentities.set(binding.store, { key: identity.key, documentScopeId })
    void enqueue(() => bindIdentity(identity, documentScopeId))
    return 'new-document'
  }

  async function resolveDocumentScopeId(
    store: EditorStore,
    identity: DocumentIdentity
  ): Promise<AIDocumentScopeId> {
    const previous = documentIdentities.get(store)
    if (!previous) {
      const documentScopeId = await options.sessionStore.resolveDocumentScopeId(
        identity.alias,
        createDocumentScopeId()
      )
      documentIdentities.set(store, { key: identity.key, documentScopeId })
      return documentScopeId
    }
    if (previous.key === identity.key) return previous.documentScopeId

    if (previous.key === null && identity.key !== null) {
      await bindIdentity(identity, previous.documentScopeId)
      documentIdentities.set(store, {
        key: identity.key,
        documentScopeId: previous.documentScopeId
      })
      return previous.documentScopeId
    }

    const documentScopeId = createDocumentScopeId()
    await bindIdentity(identity, documentScopeId)
    documentIdentities.set(store, { key: identity.key, documentScopeId })
    return documentScopeId
  }

  async function resolve(
    store: EditorStore,
    expectedProviderId: AIProviderID
  ): Promise<ActiveACPSessionBinding | null> {
    const role = options.resolveModelRole()
    if (!role || role.connection.providerID !== expectedProviderId) return null
    if (!expectedProviderId.startsWith('acp:')) return null

    const modelConfigurationId = await createACPModelConfigurationId(
      role,
      options.resolveConfigurationContext?.(role) ?? null
    )
    // Serialize reads with queued writes/deletes so Clear cannot immediately
    // resume a record whose durable deletion is still in flight.
    return enqueue(async () => {
      const identity = documentIdentity(store)
      const documentScopeId = await resolveDocumentScopeId(store, identity)
      const scope: ACPSessionScope = {
        documentScopeId,
        role: role.requestedRole,
        providerId: expectedProviderId,
        agentId: expectedProviderId.slice(4) as ACPAgentID,
        connectionId: role.connection.id,
        modelProfileId: role.profile.id,
        modelConfigurationId,
        credentialProfileId: role.connection.credentialProfileId,
        contextVersion: ACP_CHAT_CONTEXT_VERSION
      }
      const sessionKey = acpSessionScopeKey(scope)
      const liveSessionId = liveSessionIds.get(sessionKey)
      const persistent = identity.alias !== null
      const stored =
        liveSessionId || !persistent ? null : await options.sessionStore.readACPSession(scope)
      const sessionId = liveSessionId ?? stored?.sessionId ?? null
      if (sessionId) liveSessionIds.set(sessionKey, sessionId)
      return {
        store,
        scope,
        sessionId,
        persistent,
        documentAliasKey: identity.key
      }
    })
  }

  function remember(
    binding: ActiveACPSessionBinding,
    event: ACPSessionOpenedEvent
  ): ACPSessionRememberResult {
    const transition = reconcileDocumentIdentity(binding)
    if (transition === 'new-document') {
      return {
        documentChanged: true,
        restoreFailed: false,
        durability: Promise.resolve()
      }
    }

    const previousSessionId = binding.sessionId
    binding.sessionId = event.sessionId
    liveSessionIds.set(acpSessionScopeKey(binding.scope), event.sessionId)
    const durability = binding.persistent
      ? enqueue(async () => {
          await options.sessionStore.writeACPSession(binding.scope, event.sessionId, {
            resumed: event.method === 'resume'
          })
        })
      : Promise.resolve()
    return {
      documentChanged: false,
      restoreFailed: previousSessionId !== null && event.method !== 'resume',
      durability
    }
  }

  function forget(binding: ActiveACPSessionBinding | null): Promise<void> {
    if (!binding) return queue
    liveSessionIds.delete(acpSessionScopeKey(binding.scope))
    if (!binding.persistent) return queue
    return enqueue(() => options.sessionStore.deleteACPSession(binding.scope))
  }

  return { resolve, remember, forget, reconcileDocumentIdentity }
}
