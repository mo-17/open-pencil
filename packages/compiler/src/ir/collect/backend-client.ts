import { BackendProviderCompilationError } from '#compiler/compile/backend'

import { hasPrevReference, parseExpression, type ExprAst } from '@open-pencil/lowcode'
import {
  validateBackendClientAction,
  validateBackendResourceDataSource,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'
import type {
  BackendAuthAction,
  BackendCommandAction,
  BackendCommandRecoveryAction,
  BackendListQueryBinding,
  ActionPayloadEntry,
  BackendRequestAction,
  BackendResourceDataSource
} from '@open-pencil/scene-graph'

import type {
  IRBackendAuthHandler,
  IRBackendCommandHandler,
  IRBackendCommandRecoveryHandler,
  IRBackendListQueryBinding,
  IRBackendRequestHandler,
  IRBackendResourceQuery
} from '../backend-types'
import type { IRDocStateDecl, IRStateDecl } from '../types'
import { registerDocStateReads, unknownIdentifiers } from './expression-scope'

export interface BackendBindingContext {
  backendApplication?: BackendApplicationSpecV1
  states: Map<string, IRStateDecl>
  docStates: ReadonlyMap<string, IRDocStateDecl>
  inScope: ReadonlySet<string>
  docStateReads?: Set<string>
  docStateWrites?: Set<string>
}

function reject(message: string): never {
  throw new BackendProviderCompilationError([
    { code: 'backend-client-binding-invalid', severity: 'error', path: '$.bindings', message }
  ])
}

function application(ctx: BackendBindingContext): BackendApplicationSpecV1 {
  if (!ctx.backendApplication?.httpApi?.browserClient)
    return reject('Backend bindings require a complete browser client declaration.')
  return ctx.backendApplication
}

function expression(source: string | undefined, ctx: BackendBindingContext): ExprAst | undefined {
  if (source === undefined) return undefined
  const parsed = parseExpression(source)
  if (!parsed.ok || hasPrevReference(parsed.ast))
    return reject('Invalid Backend binding expression.')
  const unknown = unknownIdentifiers(parsed.references, ctx.states, ctx.inScope, ctx.docStates)
  if (unknown.length > 0)
    return reject('Backend binding expression references an unknown identifier.')
  registerDocStateReads(parsed.references, ctx.docStates, ctx.docStateReads)
  return parsed.ast
}

function expressionEntries(entries: ActionPayloadEntry[] | undefined, ctx: BackendBindingContext) {
  return entries?.map((entry) => {
    const ast = expression(entry.valueExpr, ctx)
    if (!ast) return reject('Backend field expression is required.')
    const parsed = parseExpression(entry.valueExpr)
    return { key: entry.key, ast, references: parsed.ok ? [...parsed.references] : [] }
  })
}

function queryFields(
  source: BackendListQueryBinding,
  ctx: BackendBindingContext
): IRBackendListQueryBinding {
  return {
    filterEntries: expressionEntries(source.filterEntries, ctx),
    searchAst: expression(source.searchExpr, ctx),
    sortField: source.sortField,
    sortDirection: source.sortDirection
  }
}

export function collectBackendClientAction(
  action:
    | BackendAuthAction
    | BackendRequestAction
    | BackendCommandAction
    | BackendCommandRecoveryAction,
  ctx: BackendBindingContext
):
  | IRBackendAuthHandler
  | IRBackendRequestHandler
  | IRBackendCommandHandler
  | IRBackendCommandRecoveryHandler {
  const diagnostics = validateBackendClientAction(application(ctx), action, [
    ...ctx.docStates.values()
  ])
  if (diagnostics.length > 0) throw new BackendProviderCompilationError(diagnostics)
  if (action.kind === 'backendAuth')
    return {
      kind: action.kind,
      operation: action.operation,
      returnPath: action.returnPath,
      errorTarget: action.errorTarget
    }
  if (action.kind === 'backendCommand' || action.kind === 'backendCommandRecovery') {
    ctx.docStateReads?.add(action.idempotencyKeyTarget)
    ctx.docStateWrites?.add(action.idempotencyKeyTarget)
    if (action.kind === 'backendCommandRecovery')
      return {
        kind: action.kind,
        commandId: action.commandId,
        idempotencyKeyTarget: action.idempotencyKeyTarget,
        operation: action.operation,
        attemptKeyAst: expression(action.attemptKeyExpr, ctx),
        resultTarget: action.resultTarget,
        errorTarget: action.errorTarget
      }
    return {
      kind: action.kind,
      commandId: action.commandId,
      payloadEntries: expressionEntries(action.payloadEntries, ctx),
      idempotencyKeyTarget: action.idempotencyKeyTarget,
      recovery: action.recovery,
      resultTarget: action.resultTarget,
      errorTarget: action.errorTarget
    }
  }
  return {
    kind: action.kind,
    resourceId: action.resourceId,
    operation: action.operation,
    idAst: expression(action.idExpr, ctx),
    afterAst: expression(action.afterExpr, ctx),
    payloadEntries: expressionEntries(action.payloadEntries, ctx),
    ...queryFields(action, ctx),
    limit: action.limit,
    resultTarget: action.resultTarget,
    cursorTarget: action.cursorTarget,
    errorTarget: action.errorTarget
  }
}

export function collectBackendResourceQuery(
  source: BackendResourceDataSource,
  ctx: BackendBindingContext,
  queries: IRBackendResourceQuery[] | undefined
): string {
  if (!queries) return reject('Backend resource LIST requires a page owner.')
  const diagnostics = validateBackendResourceDataSource(application(ctx), source, [
    ...ctx.docStates.values()
  ])
  if (diagnostics.length > 0) throw new BackendProviderCompilationError(diagnostics)
  const afterAst = expression(source.afterExpr, ctx)
  const query = queryFields(source, ctx)
  const deps = [
    ...new Set([
      ...[source.afterExpr, source.searchExpr].flatMap((value) => {
        const parsed = value === undefined ? undefined : parseExpression(value)
        return parsed?.ok ? [...parsed.references] : []
      }),
      ...(query.filterEntries?.flatMap((entry) => entry.references) ?? [])
    ])
  ]
  const rowsName = `__opBackendRows${queries.length}`
  if (
    ctx.states.has(rowsName) ||
    ctx.docStates.has(rowsName) ||
    [...ctx.states.values()].some((state) => state.name === rowsName)
  )
    return reject('Backend resource row identifier collides with a state.')
  if (source.nextCursorTarget) ctx.docStateWrites?.add(source.nextCursorTarget)
  if (source.errorTarget) ctx.docStateWrites?.add(source.errorTarget)
  queries.push({
    resourceId: source.resourceId,
    rowsName,
    afterAst,
    ...query,
    deps,
    limit: source.limit,
    nextCursorTarget: source.nextCursorTarget,
    errorTarget: source.errorTarget
  })
  return rowsName
}

export function backendClientConfig(application: BackendApplicationSpecV1 | undefined) {
  return application?.httpApi?.browserClient
}
export function backendTreeFields(
  application: BackendApplicationSpecV1 | undefined,
  queries: IRBackendResourceQuery[]
) {
  return {
    backendClient: backendClientConfig(application),
    backendQueries: queries.length ? queries : undefined
  }
}
export function attachBackendClient(
  definitions: Array<{ backendClient?: ReturnType<typeof backendClientConfig> }>,
  application: BackendApplicationSpecV1 | undefined
): void {
  const client = backendClientConfig(application)
  if (client) for (const definition of definitions) definition.backendClient = client
}
