import type {
  IRBackendAuthHandler,
  IRBackendCommandHandler,
  IRBackendCommandRecoveryHandler,
  IRBackendRequestHandler,
  IREventHandler
} from '#compiler/ir/types'

import type { ExprAst } from '@open-pencil/lowcode'

import { backendQueryFields } from './query-fields'

interface BackendEventEmitter {
  expression: (ast: ExprAst) => string
  statements: (handlers: IREventHandler[], aliases?: ReadonlyMap<string, string>) => string
  request: string
  auth: string
}

function queryActionKey(handler: IRBackendRequestHandler): string {
  if (handler.resultTarget) return 'result:' + handler.resultTarget
  if (handler.cursorTarget) return 'cursor:' + handler.cursorTarget
  return 'resource:' + handler.resourceId + ':' + handler.operation
}

export function emitBackendClientEvent(
  handler:
    | IRBackendAuthHandler
    | IRBackendRequestHandler
    | IRBackendCommandHandler
    | IRBackendCommandRecoveryHandler,
  emit: BackendEventEmitter
): string {
  if (handler.kind === 'backendCommand' || handler.kind === 'backendCommandRecovery')
    return emitBackendCommandEvent(handler, emit)
  const json = JSON.stringify
  const writeState = (name: string, value: string, empty: string) =>
    `${emit.auth}.setBackendState(__opBackendGeneration, ${json(name)}, ${value}, ${empty});`
  const errorWrite = handler.errorTarget
    ? writeState(handler.errorTarget, "'Backend request failed.'", "''")
    : ''
  if (handler.kind === 'backendAuth') {
    const call =
      handler.operation === 'signIn'
        ? `${emit.auth}.signIn(${json(handler.returnPath ?? '/')})`
        : `${emit.auth}.signOut()`
    return `{ const __opBackendGeneration = ${emit.auth}.getSession().generation; try { await ${call} } catch { if (!${emit.auth}.isCurrentGeneration(__opBackendGeneration)) return; ${errorWrite} console.error('Authentication request failed.') } }`
  }
  const payload = handler.payloadEntries
    ?.map((entry) => `${json(entry.key)}: ${emit.expression(entry.ast)}`)
    .join(', ')
  const fields = [
    `resourceId: ${json(handler.resourceId)}`,
    `operation: ${json(handler.operation)}`,
    ...(['list', 'read'].includes(handler.operation)
      ? [`queryKey: ${json(queryActionKey(handler))}`]
      : []),
    ...(handler.idAst ? [`id: String(${emit.expression(handler.idAst)})`] : []),
    ...(handler.afterAst
      ? [`after: String(${emit.expression(handler.afterAst)}) || undefined`]
      : []),
    ...(handler.limit === undefined ? [] : [`limit: ${handler.limit}`]),
    ...backendQueryFields(handler, emit.expression),
    ...(payload === undefined ? [] : [`payload: { ${payload} }`])
  ]
  const writes = [
    ...(handler.resultTarget
      ? [writeState(handler.resultTarget, 'data', handler.operation === 'list' ? '[]' : '{}')]
      : []),
    ...(handler.cursorTarget
      ? [writeState(handler.cursorTarget, '__opBackendResult.cursor', "''")]
      : [])
  ].join(' ')
  const { success, failure } = emitContinuations(handler, emit)
  return `{ const __opBackendGeneration = ${emit.auth}.getSession().generation; const __opBackendInput = { ${fields.join(', ')} } as const; try { const __opBackendResult = await ${emit.request}(__opBackendInput); if (!__opBackendResult.current || !${emit.auth}.isCurrentGeneration(__opBackendGeneration)) return; const data = __opBackendResult.data; ${writes} ${success} } catch { if (!${emit.auth}.isCurrentGeneration(__opBackendGeneration)) return; const error = { message: 'Backend request failed.' }; ${errorWrite} ${failure} } }`
}

function emitBackendCommandEvent(
  handler: IRBackendCommandHandler | IRBackendCommandRecoveryHandler,
  emit: BackendEventEmitter
): string {
  const json = JSON.stringify
  const fields = commandFields(handler, emit.expression)
  const write = (name: string, value: string, empty: string) =>
    `${emit.auth}.setBackendState(__opBackendGeneration, ${json(name)}, ${value}, ${empty});`
  const { success, failure } = emitContinuations(handler, emit)
  const result = handler.resultTarget ? write(handler.resultTarget, 'data', '{}') : ''
  const failed = handler.errorTarget ? write(handler.errorTarget, 'error.message', "''") : ''
  return `{ const __opBackendGeneration = ${emit.auth}.getSession().generation; const __opBackendInput = { ${fields.join(', ')} } as const; try { const __opBackendResult = await ${emit.auth}.${handler.kind}(__opBackendInput); if (!__opBackendResult.current || !${emit.auth}.isCurrentGeneration(__opBackendGeneration)) return; const data = __opBackendResult.data; ${result} ${success} } catch (__opCommandFailure) { if (!${emit.auth}.isCurrentGeneration(__opBackendGeneration)) return; const error = ${emit.auth}.commandError(__opCommandFailure); ${failed} ${failure} } }`
}

function commandFields(
  handler: IRBackendCommandHandler | IRBackendCommandRecoveryHandler,
  expression: BackendEventEmitter['expression']
): string[] {
  const fields = [`commandId: ${JSON.stringify(handler.commandId)}`]
  if (handler.kind === 'backendCommand') {
    const payload =
      handler.payloadEntries
        ?.map((entry) => `${JSON.stringify(entry.key)}: ${expression(entry.ast)}`)
        .join(', ') ?? ''
    fields.push(`payload: { ${payload} }`)
    if (handler.recovery) fields.push(`recovery: ${JSON.stringify(handler.recovery)}`)
  } else {
    fields.push(`operation: ${JSON.stringify(handler.operation)}`)
    if (handler.attemptKeyAst)
      fields.push(`attemptKey: String(${expression(handler.attemptKeyAst)})`)
  }
  fields.push(`idempotencyKeyTarget: ${JSON.stringify(handler.idempotencyKeyTarget)}`)
  return fields
}

function emitContinuations(
  handler: { onSuccess?: IREventHandler[]; onError?: IREventHandler[] },
  emit: BackendEventEmitter
) {
  return {
    success: emit.statements(handler.onSuccess ?? [], new Map([['data', 'data']])),
    failure: emit.statements(
      handler.onError ?? [],
      new Map([
        ['error', 'error'],
        ['err', 'error']
      ])
    )
  }
}
