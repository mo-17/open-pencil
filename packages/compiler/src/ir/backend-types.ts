import type { ExprAst } from '@open-pencil/lowcode'
import type { BackendHttpAPIBrowserClientIRV1 } from '@open-pencil/lowcode/backend'

import type { IREventHandler, IRSupabasePayloadEntry } from './types'

export type IRBackendClientConfig = BackendHttpAPIBrowserClientIRV1

export interface IRBackendAuthHandler {
  kind: 'backendAuth'
  operation: 'signIn' | 'signOut'
  returnPath?: string
  errorTarget?: string
}

export interface IRBackendListQueryBinding {
  filterEntries?: IRSupabasePayloadEntry[]
  searchAst?: ExprAst
  sortField?: string
  sortDirection?: 'asc' | 'desc'
}

export interface IRBackendRequestHandler extends IRBackendListQueryBinding {
  kind: 'backendRequest'
  resourceId: string
  operation: 'list' | 'read' | 'create' | 'update' | 'delete'
  idAst?: ExprAst
  afterAst?: ExprAst
  payloadEntries?: IRSupabasePayloadEntry[]
  limit?: number
  resultTarget?: string
  cursorTarget?: string
  errorTarget?: string
  onSuccess?: IREventHandler[]
  onError?: IREventHandler[]
}

export interface IRBackendResourceQuery extends IRBackendListQueryBinding {
  resourceId: string
  rowsName: string
  limit?: number
  afterAst?: ExprAst
  deps: string[]
  nextCursorTarget?: string
  errorTarget?: string
}

export interface IRBackendCommandHandler {
  kind: 'backendCommand'
  commandId: string
  payloadEntries?: IRSupabasePayloadEntry[]
  idempotencyKeyTarget: string
  recovery?: 'browser'
  resultTarget?: string
  errorTarget?: string
  onSuccess?: IREventHandler[]
  onError?: IREventHandler[]
}

export interface IRBackendCommandRecoveryHandler {
  kind: 'backendCommandRecovery'
  commandId: string
  idempotencyKeyTarget: string
  operation: 'inspect' | 'retry' | 'acknowledge'
  attemptKeyAst?: ExprAst
  resultTarget?: string
  errorTarget?: string
  onSuccess?: IREventHandler[]
  onError?: IREventHandler[]
}
