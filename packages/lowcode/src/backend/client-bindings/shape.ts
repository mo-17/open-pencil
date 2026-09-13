import { validateExpression, validateStateName } from '#lowcode/validate'

import type {
  ActionPayloadEntry,
  BackendAuthAction,
  BackendCommandAction,
  BackendCommandRecoveryAction,
  BackendListQueryBinding,
  BackendRequestAction,
  BackendResourceDataSource
} from '@open-pencil/scene-graph'

import { isBackendAuthReturnPath } from '../browser-client'
import type { BackendValidationResult } from '../types'
import {
  assertBoundedBackendData,
  diagnostic,
  id,
  oneOf,
  parseArrayItems,
  record,
  uniqueBy,
  type BackendUnknownRecord,
  type BackendValidationContext
} from '../validation-helpers'

type ClientAction =
  | BackendAuthAction
  | BackendRequestAction
  | BackendCommandAction
  | BackendCommandRecoveryAction
const QUERY_KEYS = ['filterEntries', 'searchExpr', 'sortField', 'sortDirection'] as const
const COMMAND_KEYS = [
  'id',
  'kind',
  'commandId',
  'idempotencyKeyTarget',
  'resultTarget',
  'errorTarget',
  'onSuccess',
  'onError'
] as const

function reject(context: BackendValidationContext, path: string, message: string): void {
  diagnostic(context, 'backend-client-binding-invalid', path, message)
}

function expression(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  if (typeof value === 'string' && value.length <= 4096 && validateExpression(value).ok)
    return value
  reject(context, path, 'Use a bounded expression in the shared lowcode language.')
  return undefined
}

function target(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  if (typeof value === 'string' && value.length <= 64 && validateStateName(value).ok) return value
  reject(context, path, 'Use a declared, writable document state name.')
  return undefined
}

function limit(
  value: unknown,
  path: string,
  context: BackendValidationContext
): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100)
    return value
  reject(context, path, 'Page size must be an integer between 1 and 100.')
  return undefined
}

function optionalField<T>(
  source: BackendUnknownRecord,
  key: string,
  context: BackendValidationContext,
  parse: (value: unknown, path: string, context: BackendValidationContext) => T | undefined
): T | undefined {
  return source[key] === undefined ? undefined : parse(source[key], '$.' + key, context)
}

function payload(
  value: unknown,
  path: string,
  context: BackendValidationContext
): ActionPayloadEntry[] | undefined {
  const entries = parseArrayItems(value, path, context, 128, (entry, entryPath) => {
    const source = record(entry, entryPath, context, ['key', 'valueExpr'])
    if (!source) return undefined
    const key = id(source.key, entryPath + '.key', context)
    const valueExpr = expression(source.valueExpr, entryPath + '.valueExpr', context)
    return key && valueExpr ? { key, valueExpr } : undefined
  })
  if (entries)
    uniqueBy(
      entries.map((entry) => entry.key),
      path,
      context,
      'Payload field'
    )
  return entries
}

function auth(
  source: BackendUnknownRecord,
  context: BackendValidationContext
): BackendAuthAction | undefined {
  const operation = oneOf(source.operation, '$.operation', context, ['signIn', 'signOut'])
  const actionId = id(source.id, '$.id', context)
  const returnPath = source.returnPath
  if (returnPath !== undefined && (!isBackendAuthReturnPath(returnPath) || operation !== 'signIn'))
    reject(
      context,
      '$.returnPath',
      'Only sign-in accepts a static same-origin return path outside the callback namespace.'
    )
  const errorTarget = optionalField(source, 'errorTarget', context, target)
  if (!operation || !actionId) return undefined
  return {
    id: actionId,
    kind: 'backendAuth',
    operation,
    ...(typeof returnPath === 'string' ? { returnPath } : {}),
    ...(errorTarget ? { errorTarget } : {})
  }
}

function queryBinding(
  source: BackendUnknownRecord,
  context: BackendValidationContext
): BackendListQueryBinding {
  const filterEntries = optionalField(source, 'filterEntries', context, payload)
  const searchExpr = optionalField(source, 'searchExpr', context, expression)
  const sortField = optionalField(source, 'sortField', context, id)
  const sortDirection =
    source.sortDirection === undefined
      ? undefined
      : oneOf(source.sortDirection, '$.sortDirection', context, ['asc', 'desc'])
  if ((filterEntries?.length ?? 0) > 16)
    reject(context, '$.filterEntries', 'List queries accept at most 16 declared equality filters.')
  if (sortDirection !== undefined && sortField === undefined)
    reject(context, '$.sortDirection', 'A sort direction requires a declared sort field.')
  return {
    ...(filterEntries?.length ? { filterEntries } : {}),
    ...(searchExpr === undefined ? {} : { searchExpr }),
    ...(sortField === undefined ? {} : { sortField }),
    ...(sortDirection === undefined ? {} : { sortDirection })
  }
}

function validateRequestOperationFields(
  source: BackendUnknownRecord,
  operation: BackendRequestAction['operation'] | undefined,
  idExpr: string | undefined,
  payloadEntries: ActionPayloadEntry[] | undefined,
  context: BackendValidationContext
): void {
  const item = operation === 'read' || operation === 'update' || operation === 'delete'
  if (item !== (idExpr !== undefined))
    reject(
      context,
      '$.idExpr',
      'Read, update and delete require an ID expression; list and create do not accept one.'
    )
  const mutation = operation === 'create' || operation === 'update'
  if (mutation ? !payloadEntries?.length : source.payloadEntries !== undefined)
    reject(
      context,
      '$.payloadEntries',
      'Create and update require nonempty field expressions; other operations do not accept a payload.'
    )
  if (
    operation !== 'list' &&
    (source.limit !== undefined ||
      source.afterExpr !== undefined ||
      source.cursorTarget !== undefined ||
      QUERY_KEYS.some((key) => source[key] !== undefined))
  )
    reject(
      context,
      '$.operation',
      'Pagination and query fields are accepted only for list requests.'
    )
  for (const key of ['onSuccess', 'onError']) {
    if (source[key] !== undefined && !Array.isArray(source[key]))
      reject(context, '$.' + key, 'Result branches must be action arrays.')
  }
}

function request(
  source: BackendUnknownRecord,
  context: BackendValidationContext
): BackendRequestAction | undefined {
  const operation = oneOf(source.operation, '$.operation', context, [
    'list',
    'read',
    'create',
    'update',
    'delete'
  ])
  const actionId = id(source.id, '$.id', context)
  const resourceId = id(source.resourceId, '$.resourceId', context)
  const idExpr = optionalField(source, 'idExpr', context, expression)
  const payloadEntries = optionalField(source, 'payloadEntries', context, payload)
  const pageSize = optionalField(source, 'limit', context, limit)
  const afterExpr = optionalField(source, 'afterExpr', context, expression)
  const resultTarget = optionalField(source, 'resultTarget', context, target)
  const cursorTarget = optionalField(source, 'cursorTarget', context, target)
  const errorTarget = optionalField(source, 'errorTarget', context, target)
  validateRequestOperationFields(source, operation, idExpr, payloadEntries, context)
  if (!operation || !actionId || !resourceId) return undefined
  // Branches remain owned by the caller's existing recursive ActionDef validator.
  return {
    id: actionId,
    kind: 'backendRequest',
    resourceId,
    operation,
    ...queryBinding(source, context),
    ...(idExpr === undefined ? {} : { idExpr }),
    ...(payloadEntries === undefined ? {} : { payloadEntries }),
    ...(pageSize === undefined ? {} : { limit: pageSize }),
    ...(afterExpr === undefined ? {} : { afterExpr }),
    ...(resultTarget === undefined ? {} : { resultTarget }),
    ...(cursorTarget === undefined ? {} : { cursorTarget }),
    ...(errorTarget === undefined ? {} : { errorTarget })
  }
}

function command(
  source: BackendUnknownRecord,
  context: BackendValidationContext
): BackendCommandAction | undefined {
  const actionId = id(source.id, '$.id', context)
  const commandId = id(source.commandId, '$.commandId', context)
  const idempotencyKeyTarget = target(
    source.idempotencyKeyTarget,
    '$.idempotencyKeyTarget',
    context
  )
  const payloadEntries = optionalField(source, 'payloadEntries', context, payload)
  const resultTarget = optionalField(source, 'resultTarget', context, target)
  const errorTarget = optionalField(source, 'errorTarget', context, target)
  const recovery =
    source.recovery === undefined
      ? undefined
      : oneOf(source.recovery, '$.recovery', context, ['browser'])
  for (const key of ['onSuccess', 'onError'])
    if (source[key] !== undefined && !Array.isArray(source[key]))
      reject(context, '$.' + key, 'Result branches must be action arrays.')
  if (!actionId || !commandId || !idempotencyKeyTarget) return undefined
  return {
    id: actionId,
    kind: 'backendCommand',
    commandId,
    idempotencyKeyTarget,
    ...(recovery === undefined ? {} : { recovery }),
    ...(payloadEntries?.length ? { payloadEntries } : {}),
    ...(resultTarget === undefined ? {} : { resultTarget }),
    ...(errorTarget === undefined ? {} : { errorTarget })
  }
}

function commandRecovery(
  source: BackendUnknownRecord,
  context: BackendValidationContext
): BackendCommandRecoveryAction | undefined {
  const actionId = id(source.id, '$.id', context)
  const commandId = id(source.commandId, '$.commandId', context)
  const idempotencyKeyTarget = target(
    source.idempotencyKeyTarget,
    '$.idempotencyKeyTarget',
    context
  )
  const operation = oneOf(source.operation, '$.operation', context, [
    'inspect',
    'retry',
    'acknowledge'
  ])
  const attemptKeyExpr = optionalField(source, 'attemptKeyExpr', context, expression)
  const resultTarget = optionalField(source, 'resultTarget', context, target)
  const errorTarget = optionalField(source, 'errorTarget', context, target)
  if (operation === 'inspect' ? source.attemptKeyExpr !== undefined : attemptKeyExpr === undefined)
    reject(
      context,
      '$.attemptKeyExpr',
      'Retry and acknowledge require the selected attempt key expression; inspect does not accept one.'
    )
  for (const key of ['onSuccess', 'onError'])
    if (source[key] !== undefined && !Array.isArray(source[key]))
      reject(context, '$.' + key, 'Result branches must be action arrays.')
  if (!actionId || !commandId || !idempotencyKeyTarget || !operation) return undefined
  return {
    id: actionId,
    kind: 'backendCommandRecovery',
    commandId,
    idempotencyKeyTarget,
    operation,
    ...(attemptKeyExpr === undefined ? {} : { attemptKeyExpr }),
    ...(resultTarget === undefined ? {} : { resultTarget }),
    ...(errorTarget === undefined ? {} : { errorTarget })
  }
}

function parseShape<T>(
  value: unknown,
  parse: (context: BackendValidationContext) => T | undefined
): BackendValidationResult<T> {
  const context: BackendValidationContext = { diagnostics: [] }
  try {
    if (!assertBoundedBackendData(value, context))
      return { ok: false, diagnostics: context.diagnostics }
    const parsed = parse(context)
    if (parsed && !context.diagnostics.length) return { ok: true, value: parsed, diagnostics: [] }
  } catch {
    reject(context, '$', 'Client bindings must be bounded plain data.')
  }
  return { ok: false, diagnostics: context.diagnostics }
}

/** Parse action fields only; existing recursive action walkers must validate/preserve result branches. */
export function parseBackendClientActionFields(
  value: unknown
): BackendValidationResult<ClientAction> {
  return parseShape(value, (context) => {
    const header = record(
      value,
      '$',
      context,
      [
        'id',
        'kind',
        'operation',
        'returnPath',
        'errorTarget',
        'resourceId',
        'commandId',
        'idempotencyKeyTarget',
        'recovery',
        'attemptKeyExpr',
        'idExpr',
        'payloadEntries',
        'limit',
        'afterExpr',
        ...QUERY_KEYS,
        'resultTarget',
        'cursorTarget',
        'onSuccess',
        'onError'
      ],
      ['id', 'kind']
    )
    if (!header) return undefined
    if (header.kind === 'backendCommand') {
      const source = record(
        header,
        '$',
        context,
        [...COMMAND_KEYS, 'payloadEntries', 'recovery'],
        ['id', 'kind', 'commandId', 'idempotencyKeyTarget']
      )
      return source ? command(source, context) : undefined
    }
    if (header.kind === 'backendCommandRecovery') {
      const source = record(
        header,
        '$',
        context,
        [...COMMAND_KEYS, 'operation', 'attemptKeyExpr'],
        ['id', 'kind', 'commandId', 'idempotencyKeyTarget', 'operation']
      )
      return source ? commandRecovery(source, context) : undefined
    }
    const allowed =
      header.kind === 'backendAuth'
        ? ['id', 'kind', 'operation', 'returnPath', 'errorTarget']
        : [
            'id',
            'kind',
            'operation',
            'errorTarget',
            'resourceId',
            'idExpr',
            'payloadEntries',
            'limit',
            'afterExpr',
            ...QUERY_KEYS,
            'resultTarget',
            'cursorTarget',
            'onSuccess',
            'onError'
          ]
    const source = record(header, '$', context, allowed, ['id', 'kind', 'operation'])
    if (!source) return undefined
    if (source.kind === 'backendAuth') return auth(source, context)
    if (source.kind === 'backendRequest') return request(source, context)
    reject(context, '$.kind', 'Expected a declared Backend client action.')
    return undefined
  })
}

export function parseBackendResourceDataSource(
  value: unknown
): BackendValidationResult<BackendResourceDataSource> {
  return parseShape(value, (context) => {
    const source = record(
      value,
      '$',
      context,
      [
        'kind',
        'resourceId',
        'limit',
        'afterExpr',
        'nextCursorTarget',
        'errorTarget',
        ...QUERY_KEYS
      ],
      ['kind', 'resourceId']
    )
    if (!source) return undefined
    const kind = oneOf(source.kind, '$.kind', context, ['backendResource'])
    const resourceId = id(source.resourceId, '$.resourceId', context)
    const pageSize = optionalField(source, 'limit', context, limit)
    const afterExpr = optionalField(source, 'afterExpr', context, expression)
    const nextCursorTarget = optionalField(source, 'nextCursorTarget', context, target)
    const errorTarget = optionalField(source, 'errorTarget', context, target)
    return kind && resourceId
      ? {
          kind,
          resourceId,
          ...queryBinding(source, context),
          ...(pageSize === undefined ? {} : { limit: pageSize }),
          ...(afterExpr === undefined ? {} : { afterExpr }),
          ...(nextCursorTarget === undefined ? {} : { nextCursorTarget }),
          ...(errorTarget === undefined ? {} : { errorTarget })
        }
      : undefined
  })
}
