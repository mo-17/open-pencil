import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import type { AIModelProfileId, AIModelRole } from '@/app/ai/models/types'

export const AI_SESSION_SCHEMA_VERSION = 1 as const
export const AI_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000
export const AI_SESSION_GLOBAL_LIMIT = 200
export const AI_SESSION_PER_DOCUMENT_LIMIT = 8

export type AIDocumentScopeId = `ai-doc-${string}`

export type AIDocumentAlias =
  | Readonly<{ kind: 'path'; path: string }>
  | Readonly<{
      kind: 'storage'
      providerId: string
      profileId?: string
      accountId?: string
      documentId: string
    }>

export type ACPSessionScope = Readonly<{
  documentScopeId: AIDocumentScopeId
  role: AIModelRole
  providerId: AIProviderID
  agentId: ACPAgentID
  connectionId: string
  modelProfileId: AIModelProfileId
  modelConfigurationId: string
  credentialProfileId: string
  contextVersion: string
}>

export type StoredAIDocumentAliasV1 = Readonly<{
  schemaVersion: typeof AI_SESSION_SCHEMA_VERSION
  aliasKey: string
  alias: AIDocumentAlias
  documentScopeId: AIDocumentScopeId
  updatedAt: number
}>

export type StoredACPSessionV1 = Readonly<
  ACPSessionScope & {
    schemaVersion: typeof AI_SESSION_SCHEMA_VERSION
    sessionKey: string
    sessionId: string
    createdAt: number
    updatedAt: number
    lastResumedAt: number | null
  }
>

export type WriteACPSessionOptions = Readonly<{
  now?: number
  resumed?: boolean
}>

export type AISessionCleanupResult = Readonly<{
  deletedSessions: number
  deletedAliases: number
}>

export interface AISessionStore {
  resolveDocumentScopeId(
    alias: AIDocumentAlias | null,
    preferredDocumentScopeId: AIDocumentScopeId,
    now?: number
  ): Promise<AIDocumentScopeId>
  bindDocumentAlias(
    alias: AIDocumentAlias,
    documentScopeId: AIDocumentScopeId,
    now?: number
  ): Promise<void>
  deleteDocumentAlias(alias: AIDocumentAlias): Promise<void>
  readACPSession(scope: ACPSessionScope, now?: number): Promise<StoredACPSessionV1 | null>
  listACPSessionsForDocument(
    documentScopeId: AIDocumentScopeId,
    now?: number
  ): Promise<StoredACPSessionV1[]>
  writeACPSession(
    scope: ACPSessionScope,
    sessionId: string,
    options?: WriteACPSessionOptions
  ): Promise<StoredACPSessionV1>
  deleteACPSession(scope: ACPSessionScope): Promise<void>
  cleanup(now?: number): Promise<AISessionCleanupResult>
}

export interface AISessionStorageBackend {
  resolveAlias(candidate: StoredAIDocumentAliasV1): Promise<unknown>
  getAlias(aliasKey: string): Promise<unknown>
  putAlias(record: unknown): Promise<void>
  deleteAlias(aliasKey: string): Promise<void>
  listAliases(): Promise<unknown[]>
  getSession(sessionKey: string): Promise<unknown>
  putSession(record: unknown): Promise<void>
  deleteSession(sessionKey: string): Promise<void>
  listSessions(): Promise<unknown[]>
  deleteSessions(sessionKeys: readonly string[]): Promise<void>
}
