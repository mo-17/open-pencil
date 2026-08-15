import type {
  ServerActionDef,
  ServerWorkflowDef,
  SupabaseFilter,
  SupabasePayloadEntry
} from '@open-pencil/scene-graph'

import { parseExpression } from '../expression'
import { findServerWorkflowSecretLiteral, serverWorkflowSafePathKey } from './secrets'
import {
  type ServerValidationResult as Result,
  isServerRecord as isRecord,
  serverFail as fail,
  validateServerExactKeys as exactKeys,
  validateServerExpression as expression,
  validateServerFilters as filters,
  validateServerHeaders as headers,
  validateServerIdentifier as identifier,
  validateServerPayloadEntries as payloadEntries,
  validateServerResultName as resultName,
  validateServerValueSource as valueSource
} from './values'

export type ServerWorkflowValidationResult =
  | { ok: true; workflows: ServerWorkflowDef[] }
  | { ok: false; error: string }

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const MUTATION_OPS = new Set(['insert', 'update', 'delete', 'upsert'])
const SERVER_SCOPE_BUILTINS = ['$currentUser', 'true', 'false', 'null', 'undefined']
const ACTION_KINDS = new Set([
  'httpRequest',
  'supabaseQuery',
  'supabaseMutation',
  'condition',
  'return',
  'callServerWorkflow'
])

function httpRequest(
  where: string,
  raw: Record<string, unknown>,
  scope: ReadonlySet<string>
): Result<ServerActionDef> {
  const keys = exactKeys(where, raw, [
    'id',
    'kind',
    'method',
    'url',
    'headers',
    'body',
    'resultName'
  ])
  if (!keys.ok) return keys
  if (typeof raw.method !== 'string' || !HTTP_METHODS.has(raw.method)) {
    return fail(`${where}.method`, 'must be GET, POST, PUT, PATCH, or DELETE')
  }
  if (raw.method === 'GET' && raw.body !== undefined) {
    return fail(`${where}.body`, 'is not allowed for GET requests')
  }
  const url = valueSource(`${where}.url`, raw.url, scope)
  if (!url.ok) return url
  if (url.value.kind === 'expr') {
    const parsedURL = parseExpression(url.value.expr)
    if (!parsedURL.ok || parsedURL.references.size > 0) {
      return fail(
        `${where}.url`,
        'must be an environment reference or a static expression without workflow values'
      )
    }
  }
  const parsedHeaders = headers(`${where}.headers`, raw.headers, scope)
  if (!parsedHeaders.ok) return parsedHeaders
  const body =
    raw.body === undefined
      ? ({ ok: true, value: undefined } as const)
      : valueSource(`${where}.body`, raw.body, scope)
  if (!body.ok) return body
  const name = resultName(`${where}.resultName`, raw.resultName, false)
  if (!name.ok) return name
  return {
    ok: true,
    value: {
      id: raw.id as string,
      kind: 'httpRequest',
      method: raw.method as Extract<ServerActionDef, { kind: 'httpRequest' }>['method'],
      url: url.value,
      ...(parsedHeaders.value !== undefined ? { headers: parsedHeaders.value } : {}),
      ...(body.value !== undefined ? { body: body.value } : {}),
      ...(name.value !== undefined ? { resultName: name.value } : {})
    }
  }
}

function supabaseQuery(
  where: string,
  raw: Record<string, unknown>,
  scope: ReadonlySet<string>
): Result<ServerActionDef> {
  const keys = exactKeys(where, raw, [
    'id',
    'kind',
    'table',
    'columns',
    'filters',
    'single',
    'resultName'
  ])
  if (!keys.ok) return keys
  if (typeof raw.table !== 'string' || raw.table.trim() === '') {
    return fail(`${where}.table`, 'must be a non-empty string')
  }
  if (raw.columns !== undefined && (typeof raw.columns !== 'string' || raw.columns.trim() === '')) {
    return fail(`${where}.columns`, 'must be a non-empty string when present')
  }
  if (raw.single !== undefined && typeof raw.single !== 'boolean') {
    return fail(`${where}.single`, 'must be a boolean')
  }
  const parsedFilters = filters(`${where}.filters`, raw.filters, scope)
  if (!parsedFilters.ok) return parsedFilters
  const name = resultName(`${where}.resultName`, raw.resultName, true)
  if (!name.ok) return name
  if (name.value === undefined) return fail(`${where}.resultName`, 'must be a valid identifier')
  return {
    ok: true,
    value: {
      id: raw.id as string,
      kind: 'supabaseQuery',
      table: raw.table,
      ...(typeof raw.columns === 'string' ? { columns: raw.columns } : {}),
      ...(parsedFilters.value !== undefined ? { filters: parsedFilters.value } : {}),
      ...(typeof raw.single === 'boolean' ? { single: raw.single } : {}),
      resultName: name.value
    }
  }
}

function mutationSemantics(
  where: string,
  operation: string,
  entries: SupabasePayloadEntry[] | undefined,
  parsedFilters: SupabaseFilter[] | undefined
): { ok: true } | { ok: false; error: string } {
  if (operation === 'delete') {
    if (entries !== undefined) return fail(`${where}.payloadEntries`, 'is not allowed for delete')
  } else if (!entries || entries.length === 0) {
    return fail(`${where}.payloadEntries`, `is required for ${operation}`)
  }
  if (operation === 'update' || operation === 'delete') {
    if (!parsedFilters || parsedFilters.length === 0) {
      return fail(`${where}.filters`, `must contain at least one filter for ${operation}`)
    }
  } else if (parsedFilters !== undefined) {
    return fail(`${where}.filters`, `is not allowed for ${operation}`)
  }
  return { ok: true }
}

function supabaseMutation(
  where: string,
  raw: Record<string, unknown>,
  scope: ReadonlySet<string>
): Result<ServerActionDef> {
  const keys = exactKeys(where, raw, [
    'id',
    'kind',
    'operation',
    'table',
    'payloadEntries',
    'filters',
    'resultName'
  ])
  if (!keys.ok) return keys
  if (typeof raw.operation !== 'string' || !MUTATION_OPS.has(raw.operation)) {
    return fail(`${where}.operation`, 'must be insert, update, delete, or upsert')
  }
  if (typeof raw.table !== 'string' || raw.table.trim() === '') {
    return fail(`${where}.table`, 'must be a non-empty string')
  }
  const entries = payloadEntries(`${where}.payloadEntries`, raw.payloadEntries, scope)
  if (!entries.ok) return entries
  const parsedFilters = filters(`${where}.filters`, raw.filters, scope)
  if (!parsedFilters.ok) return parsedFilters
  const semantics = mutationSemantics(where, raw.operation, entries.value, parsedFilters.value)
  if (!semantics.ok) return semantics
  const name = resultName(`${where}.resultName`, raw.resultName, false)
  if (!name.ok) return name
  return {
    ok: true,
    value: {
      id: raw.id as string,
      kind: 'supabaseMutation',
      operation: raw.operation as Extract<
        ServerActionDef,
        { kind: 'supabaseMutation' }
      >['operation'],
      table: raw.table,
      ...(entries.value !== undefined ? { payloadEntries: entries.value } : {}),
      ...(parsedFilters.value !== undefined ? { filters: parsedFilters.value } : {}),
      ...(name.value !== undefined ? { resultName: name.value } : {})
    }
  }
}

function actionArray(
  where: string,
  raw: unknown,
  ids: Set<string>,
  initialScope: ReadonlySet<string>
): Result<ServerActionDef[]> {
  if (!Array.isArray(raw)) return fail(where, 'must be an array')
  const output: ServerActionDef[] = []
  const scope = new Set(initialScope)
  for (let i = 0; i < raw.length; i++) {
    const actionWhere = `${where}[${i}]`
    const parsed = action(actionWhere, raw[i], ids, scope)
    if (!parsed.ok) return parsed
    const producedName = actionResultName(parsed.value)
    if (producedName !== undefined) {
      if (scope.has(producedName)) {
        return fail(`${actionWhere}.resultName`, 'must not shadow an existing workflow value')
      }
      scope.add(producedName)
    }
    output.push(parsed.value)
  }
  return { ok: true, value: output }
}

function condition(
  where: string,
  raw: Record<string, unknown>,
  ids: Set<string>,
  scope: ReadonlySet<string>
): Result<ServerActionDef> {
  const keys = exactKeys(where, raw, ['id', 'kind', 'condExpr', 'consequent', 'alternate'])
  if (!keys.ok) return keys
  const condExpr = expression(`${where}.condExpr`, raw.condExpr, scope)
  if (!condExpr.ok) return condExpr
  const consequent = actionArray(`${where}.consequent`, raw.consequent, ids, scope)
  if (!consequent.ok) return consequent
  const alternate =
    raw.alternate === undefined
      ? ({ ok: true, value: undefined } as const)
      : actionArray(`${where}.alternate`, raw.alternate, ids, scope)
  if (!alternate.ok) return alternate
  return {
    ok: true,
    value: {
      id: raw.id as string,
      kind: 'condition',
      condExpr: condExpr.value,
      consequent: consequent.value,
      ...(alternate.value !== undefined ? { alternate: alternate.value } : {})
    }
  }
}

function returnAction(
  where: string,
  raw: Record<string, unknown>,
  scope: ReadonlySet<string>
): Result<ServerActionDef> {
  const keys = exactKeys(where, raw, ['id', 'kind', 'valueExpr', 'status'])
  if (!keys.ok) return keys
  const valueExpr =
    raw.valueExpr === undefined
      ? ({ ok: true, value: undefined } as const)
      : expression(`${where}.valueExpr`, raw.valueExpr, scope)
  if (!valueExpr.ok) return valueExpr
  if (
    raw.status !== undefined &&
    (typeof raw.status !== 'number' ||
      !Number.isInteger(raw.status) ||
      raw.status < 200 ||
      raw.status > 599)
  ) {
    return fail(`${where}.status`, 'must be an integer from 200 through 599')
  }
  return {
    ok: true,
    value: {
      id: raw.id as string,
      kind: 'return',
      ...(valueExpr.value !== undefined ? { valueExpr: valueExpr.value } : {}),
      ...(typeof raw.status === 'number' ? { status: raw.status } : {})
    }
  }
}

function callWorkflow(
  where: string,
  raw: Record<string, unknown>,
  scope: ReadonlySet<string>
): Result<ServerActionDef> {
  const keys = exactKeys(where, raw, ['id', 'kind', 'workflowId', 'args'])
  if (!keys.ok) return keys
  if (typeof raw.workflowId !== 'string' || raw.workflowId.trim() === '') {
    return fail(`${where}.workflowId`, 'must be a non-empty string')
  }
  let args: Record<string, string> | undefined
  if (raw.args !== undefined) {
    if (!isRecord(raw.args)) return fail(`${where}.args`, 'must be an object')
    args = {}
    for (const [name, rawExpression] of Object.entries(raw.args)) {
      const key = identifier(`${where}.args.${serverWorkflowSafePathKey(name)}`, name)
      if (!key.ok) return key
      const parsed = expression(`${where}.args.${name}`, rawExpression, scope)
      if (!parsed.ok) return parsed
      args[name] = parsed.value
    }
  }
  return {
    ok: true,
    value: {
      id: raw.id as string,
      kind: 'callServerWorkflow',
      workflowId: raw.workflowId,
      ...(args !== undefined ? { args } : {})
    }
  }
}

function action(
  where: string,
  raw: unknown,
  ids: Set<string>,
  scope: ReadonlySet<string>
): Result<ServerActionDef> {
  if (!isRecord(raw)) return fail(where, 'must be an object')
  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    return fail(`${where}.id`, 'must be a non-empty string')
  }
  if (ids.has(raw.id)) return fail(`${where}.id`, 'is duplicated within the workflow')
  if (typeof raw.kind !== 'string' || !ACTION_KINDS.has(raw.kind)) {
    return fail(`${where}.kind`, 'must be a supported server action kind')
  }
  ids.add(raw.id)
  if (raw.kind === 'httpRequest') return httpRequest(where, raw, scope)
  if (raw.kind === 'supabaseQuery') return supabaseQuery(where, raw, scope)
  if (raw.kind === 'supabaseMutation') return supabaseMutation(where, raw, scope)
  if (raw.kind === 'condition') return condition(where, raw, ids, scope)
  if (raw.kind === 'return') return returnAction(where, raw, scope)
  return callWorkflow(where, raw, scope)
}

function actionResultName(action: ServerActionDef): string | undefined {
  if (
    action.kind === 'httpRequest' ||
    action.kind === 'supabaseQuery' ||
    action.kind === 'supabaseMutation'
  ) {
    return action.resultName
  }
  return undefined
}

function trigger(where: string, raw: unknown): Result<ServerWorkflowDef['trigger']> {
  if (!isRecord(raw)) return fail(where, 'must be an object')
  const keys = exactKeys(where, raw, ['kind', 'method', 'auth'])
  if (!keys.ok) return keys
  if (raw.kind !== 'http') return fail(`${where}.kind`, 'must be "http"')
  if (raw.method !== 'POST') return fail(`${where}.method`, 'must be "POST"')
  if (raw.auth !== 'supabase-user') return fail(`${where}.auth`, 'must be "supabase-user"')
  return { ok: true, value: { kind: 'http', method: 'POST', auth: 'supabase-user' } }
}

function params(where: string, raw: unknown): Result<string[] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (!Array.isArray(raw)) return fail(where, 'must be an array of identifiers')
  const output: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const parsed = identifier(`${where}[${i}]`, raw[i])
    if (!parsed.ok) return parsed
    if (seen.has(parsed.value)) return fail(`${where}[${i}]`, 'is duplicated')
    seen.add(parsed.value)
    output.push(parsed.value)
  }
  return { ok: true, value: output }
}

interface CallSite {
  callerId: string
  workflowId: string
  args: Record<string, string> | undefined
  where: string
}

function collectCalls(
  callerId: string,
  actions: readonly ServerActionDef[],
  where: string,
  output: CallSite[]
): void {
  for (let i = 0; i < actions.length; i++) {
    const item = actions[i]
    const itemWhere = `${where}[${i}]`
    if (item.kind === 'callServerWorkflow') {
      output.push({ callerId, workflowId: item.workflowId, args: item.args, where: itemWhere })
    } else if (item.kind === 'condition') {
      collectCalls(callerId, item.consequent, `${itemWhere}.consequent`, output)
      if (item.alternate) collectCalls(callerId, item.alternate, `${itemWhere}.alternate`, output)
    }
  }
}

function callArguments(
  site: CallSite,
  target: ServerWorkflowDef
): { ok: true } | { ok: false; error: string } {
  const expected = target.params ?? []
  const args = site.args ?? {}
  for (const name of Object.keys(args)) {
    if (!expected.includes(name)) {
      return fail(`${site.where}.args.${name}`, 'is not declared by the referenced workflow')
    }
  }
  for (const name of expected) {
    if (!(name in args)) return fail(`${site.where}.args`, `is missing required argument "${name}"`)
  }
  return { ok: true }
}

function cycle(
  workflows: readonly ServerWorkflowDef[],
  calls: readonly CallSite[]
): string | undefined {
  const edges = new Map(workflows.map((workflow) => [workflow.id, new Set<string>()]))
  for (const call of calls) edges.get(call.callerId)?.add(call.workflowId)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const path: string[] = []
  const visit = (id: string): string | undefined => {
    if (visiting.has(id)) {
      const start = path.indexOf(id)
      return [...path.slice(start), id].join(' -> ')
    }
    if (visited.has(id)) return undefined
    visiting.add(id)
    path.push(id)
    for (const next of edges.get(id) ?? []) {
      const found = visit(next)
      if (found) return found
    }
    path.pop()
    visiting.delete(id)
    visited.add(id)
    return undefined
  }
  for (const workflow of workflows) {
    const found = visit(workflow.id)
    if (found) return found
  }
  return undefined
}

function references(
  workflows: readonly ServerWorkflowDef[],
  rootWhere: string
): { ok: true } | { ok: false; error: string } {
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]))
  const calls: CallSite[] = []
  for (let i = 0; i < workflows.length; i++) {
    collectCalls(workflows[i].id, workflows[i].actions, `${rootWhere}[${i}].actions`, calls)
  }
  for (const site of calls) {
    const target = byId.get(site.workflowId)
    if (!target) return fail(`${site.where}.workflowId`, 'references an unknown workflow')
    const args = callArguments(site, target)
    if (!args.ok) return args
  }
  const foundCycle = cycle(workflows, calls)
  if (foundCycle) return fail(rootWhere, `contains a call cycle: ${foundCycle}`)
  return { ok: true }
}

/** Strictly validates and normalizes the server-workflow persistence contract.
 * This is the shared trust boundary for tools, future editor UI, and compiler
 * consumers. It rejects unknown fields and scans all stored strings for known
 * high-confidence secret formats without ever including a detected value in
 * its returned error. */
export function validateServerWorkflows(
  raw: unknown,
  rootWhere = 'server_workflows_json'
): ServerWorkflowValidationResult {
  const secretPath = findServerWorkflowSecretLiteral(raw, rootWhere)
  if (secretPath) {
    return fail(secretPath, 'contains a secret literal; use an environment-variable reference')
  }
  if (!Array.isArray(raw)) return fail(rootWhere, 'must be an array')
  const workflows: ServerWorkflowDef[] = []
  const ids = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const where = `${rootWhere}[${i}]`
    const item = raw[i]
    if (!isRecord(item)) return fail(where, 'must be an object')
    const keys = exactKeys(where, item, ['id', 'name', 'trigger', 'params', 'actions'])
    if (!keys.ok) return keys
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      return fail(`${where}.id`, 'must be a non-empty string')
    }
    if (ids.has(item.id)) return fail(`${where}.id`, 'is duplicated')
    if (typeof item.name !== 'string' || item.name.trim() === '') {
      return fail(`${where}.name`, 'must be a non-empty string')
    }
    const parsedTrigger = trigger(`${where}.trigger`, item.trigger)
    if (!parsedTrigger.ok) return parsedTrigger
    const parsedParams = params(`${where}.params`, item.params)
    if (!parsedParams.ok) return parsedParams
    const initialScope = new Set([...SERVER_SCOPE_BUILTINS, ...(parsedParams.value ?? [])])
    const actions = actionArray(`${where}.actions`, item.actions, new Set(), initialScope)
    if (!actions.ok) return actions
    ids.add(item.id)
    workflows.push({
      id: item.id,
      name: item.name,
      trigger: parsedTrigger.value,
      ...(parsedParams.value !== undefined ? { params: parsedParams.value } : {}),
      actions: actions.value
    })
  }
  const checkedReferences = references(workflows, rootWhere)
  if (!checkedReferences.ok) return checkedReferences
  return { ok: true, workflows }
}
