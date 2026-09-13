import type {
  BackendAuthAction,
  BackendCommandAction,
  BackendCommandRecoveryAction,
  BackendListQueryBinding,
  BackendRequestAction,
  BackendResourceDataSource,
  DocumentStateDef
} from '@open-pencil/scene-graph'

import type {
  BackendApplicationSpecV1,
  BackendDiagnostic,
  BackendHttpAPIResourceIRV1
} from '../types'
import { parseBackendClientActionFields, parseBackendResourceDataSource } from './shape'

function invalid(path: string, message: string): BackendDiagnostic {
  return { code: 'backend-client-binding-invalid', severity: 'error', path, message }
}

function clientDiagnostics(application: BackendApplicationSpecV1): BackendDiagnostic[] {
  return application.httpApi?.browserClient
    ? []
    : [
        invalid(
          '$.httpApi.browserClient',
          'Configure the public browser login client before binding authenticated UI.'
        )
      ]
}

function targetDiagnostics(
  name: string | undefined,
  expected: DocumentStateDef['type'],
  states: readonly DocumentStateDef[] | undefined,
  path: string
): BackendDiagnostic[] {
  if (name === undefined || states === undefined) return []
  const state = states.find((entry) => entry.name === name)
  if (state?.type === expected && !state.persist && !state.computedExpr) return []
  return [
    invalid(
      path,
      'Backend results and errors require a declared non-persistent document state of type ' +
        expected +
        '.'
    )
  ]
}

function resourceDiagnostics(
  application: BackendApplicationSpecV1,
  resourceId: string,
  operation: BackendRequestAction['operation'],
  pageSize?: number
): BackendDiagnostic[] {
  const resource = application.httpApi?.resources.find((entry) => entry.id === resourceId)
  if (!resource || !resource.operations.includes(operation))
    return [
      invalid(
        '$.resourceId',
        'The resource and operation must be explicitly exposed by the document HTTP API.'
      )
    ]
  if (operation === 'list' && pageSize !== undefined && pageSize > (resource.maxPageSize ?? 0))
    return [invalid('$.limit', 'The requested page size exceeds the declared resource limit.')]
  return []
}

function payloadDiagnostics(
  application: BackendApplicationSpecV1,
  action: BackendRequestAction,
  resource: BackendHttpAPIResourceIRV1 | undefined
): BackendDiagnostic[] {
  if (!resource || (action.operation !== 'create' && action.operation !== 'update')) return []
  const diagnostics: BackendDiagnostic[] = []
  const allowed = action.operation === 'create' ? resource.createFields : resource.updateFields
  const supplied = new Set(action.payloadEntries?.map((entry) => entry.key))
  if ([...supplied].some((key) => !allowed?.includes(key)))
    diagnostics.push(
      invalid('$.payloadEntries', 'Payload fields must belong to the operation write projection.')
    )
  if (action.operation === 'create') {
    const entity = application.dataModel.entities.find((entry) => entry.id === resource.entityId)
    if (
      entity?.fields.some(
        (field) =>
          allowed?.includes(field.id) &&
          !field.nullable &&
          !field.default &&
          !supplied.has(field.id)
      )
    )
      diagnostics.push(
        invalid(
          '$.payloadEntries',
          'Provide expressions for all required create fields without a server default.'
        )
      )
  }
  return diagnostics
}

function queryDiagnostics(
  binding: BackendListQueryBinding,
  resource: BackendHttpAPIResourceIRV1 | undefined
): BackendDiagnostic[] {
  if (!resource) return []
  const diagnostics: BackendDiagnostic[] = []
  if (binding.filterEntries?.some((entry) => !resource.query?.filterFields.includes(entry.key)))
    diagnostics.push(
      invalid(
        '$.filterEntries',
        'Filter fields must belong to the declared resource query projection.'
      )
    )
  if (binding.searchExpr !== undefined && !resource.query?.searchFields.length)
    diagnostics.push(
      invalid('$.searchExpr', 'Search requires explicitly declared resource search fields.')
    )
  if (binding.sortField !== undefined && !resource.query?.sortFields.includes(binding.sortField))
    diagnostics.push(
      invalid('$.sortField', 'Sort fields must belong to the declared resource query projection.')
    )
  return diagnostics
}

/** Expressions are parsed here; the Compiler resolves identifiers in each actual event scope. */
export function validateBackendClientAction(
  application: BackendApplicationSpecV1,
  action:
    | BackendRequestAction
    | BackendAuthAction
    | BackendCommandAction
    | BackendCommandRecoveryAction,
  documentStates?: readonly DocumentStateDef[]
): BackendDiagnostic[] {
  const parsed = parseBackendClientActionFields(action)
  if (!parsed.ok) return parsed.diagnostics
  const value = parsed.value
  const diagnostics = [
    ...clientDiagnostics(application),
    ...targetDiagnostics(value.errorTarget, 'string', documentStates, '$.errorTarget')
  ]
  if (value.kind === 'backendAuth') return diagnostics
  if (value.kind === 'backendCommand' || value.kind === 'backendCommandRecovery') {
    const command = application.commands?.commands.find((entry) => entry.id === value.commandId)
    if (!command)
      diagnostics.push(invalid('$.commandId', 'Select an explicitly declared server command.'))
    else if (value.kind === 'backendCommand') {
      const keys = new Set(value.payloadEntries?.map((entry) => entry.key))
      if (
        keys.size !== command.parameters.length ||
        command.parameters.some((parameter) => !keys.has(parameter.name))
      )
        diagnostics.push(
          invalid('$.payloadEntries', 'Provide exactly the declared command parameters.')
        )
    }
    diagnostics.push(
      ...targetDiagnostics(
        value.idempotencyKeyTarget,
        'string',
        documentStates,
        '$.idempotencyKeyTarget'
      ),
      ...targetDiagnostics(value.resultTarget, 'object', documentStates, '$.resultTarget')
    )
    if (
      value.idempotencyKeyTarget === value.errorTarget ||
      value.idempotencyKeyTarget === value.resultTarget
    )
      diagnostics.push(
        invalid('$.idempotencyKeyTarget', 'The attempt key requires its own state target.')
      )
    return diagnostics
  }
  const resource = application.httpApi?.resources.find((entry) => entry.id === value.resourceId)
  diagnostics.push(
    ...resourceDiagnostics(application, value.resourceId, value.operation, value.limit),
    ...payloadDiagnostics(application, value, resource),
    ...queryDiagnostics(value, resource),
    ...targetDiagnostics(
      value.resultTarget,
      value.operation === 'list' ? 'array' : 'object',
      documentStates,
      '$.resultTarget'
    ),
    ...targetDiagnostics(value.cursorTarget, 'string', documentStates, '$.cursorTarget')
  )
  return diagnostics
}

export function validateBackendResourceDataSource(
  application: BackendApplicationSpecV1,
  source: BackendResourceDataSource,
  documentStates?: readonly DocumentStateDef[]
): BackendDiagnostic[] {
  const parsed = parseBackendResourceDataSource(source)
  if (!parsed.ok) return parsed.diagnostics
  const value = parsed.value
  return [
    ...clientDiagnostics(application),
    ...resourceDiagnostics(application, value.resourceId, 'list', value.limit),
    ...queryDiagnostics(
      value,
      application.httpApi?.resources.find((entry) => entry.id === value.resourceId)
    ),
    ...targetDiagnostics(value.nextCursorTarget, 'string', documentStates, '$.nextCursorTarget'),
    ...targetDiagnostics(value.errorTarget, 'string', documentStates, '$.errorTarget')
  ]
}
