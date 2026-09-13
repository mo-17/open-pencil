import type { ActionDef } from './types'

/** An authored field value in the shared restricted expression language. */
export interface ActionPayloadEntry {
  key: string
  valueExpr: string
}

/** Bounded list filters use declared resource fields and the shared expression language. */
export interface BackendListQueryBinding {
  filterEntries?: ActionPayloadEntry[]
  searchExpr?: string
  sortField?: string
  sortDirection?: 'asc' | 'desc'
}

/** Login is performed by the configured public OIDC client, never an authored URL or token. */
export interface BackendAuthAction {
  id: string
  kind: 'backendAuth'
  operation: 'signIn' | 'signOut'
  returnPath?: string
  errorTarget?: string
}

/** Invoke only operations and field projections declared by the document's HTTP API. */
export interface BackendRequestAction extends BackendListQueryBinding {
  id: string
  kind: 'backendRequest'
  resourceId: string
  operation: 'list' | 'read' | 'create' | 'update' | 'delete'
  idExpr?: string
  payloadEntries?: ActionPayloadEntry[]
  limit?: number
  afterExpr?: string
  resultTarget?: string
  cursorTarget?: string
  errorTarget?: string
  onSuccess?: ActionDef[]
  onError?: ActionDef[]
}

/** A declared atomic server command; retries retain one caller-controlled attempt key. */
export interface BackendCommandAction {
  id: string
  kind: 'backendCommand'
  commandId: string
  payloadEntries?: ActionPayloadEntry[]
  idempotencyKeyTarget: string
  recovery?: 'browser'
  resultTarget?: string
  errorTarget?: string
  onSuccess?: ActionDef[]
  onError?: ActionDef[]
}

/** Inspect or explicitly resume an account-bound command attempt retained by the browser. */
export interface BackendCommandRecoveryAction {
  id: string
  kind: 'backendCommandRecovery'
  commandId: string
  idempotencyKeyTarget: string
  operation: 'inspect' | 'retry' | 'acknowledge'
  attemptKeyExpr?: string
  resultTarget?: string
  errorTarget?: string
  onSuccess?: ActionDef[]
  onError?: ActionDef[]
}

/** A session-bound LIST query with declared filters and server-owned keyset pagination. */
export interface BackendResourceDataSource extends BackendListQueryBinding {
  kind: 'backendResource'
  resourceId: string
  limit?: number
  afterExpr?: string
  nextCursorTarget?: string
  errorTarget?: string
}
