import { parseExpression, validateServerWorkflows } from '@open-pencil/lowcode'
import type { ExprAst } from '@open-pencil/lowcode'
import type {
  ServerActionDef,
  ServerValueSource,
  ServerWorkflowDef
} from '@open-pencil/scene-graph'

import type {
  IRServerAction,
  IRServerPayloadEntry,
  IRServerSupabaseFilter,
  IRServerValueSource,
  IRServerWorkflow,
  IRWarning
} from '../types'

export type ServerWorkflowCollectionResult =
  | Readonly<{ ok: true; workflows?: readonly IRServerWorkflow[] }>
  | Readonly<{ ok: false }>

/** Strict compatibility parser used when a newer Backend application is also
 * present. Invalid legacy declarations must be distinguishable from absence so
 * the authority resolver can fail closed instead of silently accepting drift. */
export function parseServerWorkflows(raw: unknown): ServerWorkflowCollectionResult {
  if (raw === undefined) return { ok: true }
  const validated = validateServerWorkflows(raw, 'lowcodeServerWorkflows')
  if (!validated.ok) return { ok: false }
  if (validated.workflows.length === 0) return { ok: true }
  try {
    return { ok: true, workflows: validated.workflows.map(lowerWorkflow) }
  } catch {
    return { ok: false }
  }
}

/** Revalidate untrusted document data and lower it into adapter-only IR. No
 *  validator detail is surfaced because the rejected payload can contain a
 *  secret; callers receive one stable, secret-free diagnostic instead. */
export function collectServerWorkflows(
  raw: unknown,
  warnings: IRWarning[]
): IRServerWorkflow[] | undefined {
  const parsed = parseServerWorkflows(raw)
  if (!parsed.ok) {
    warnings.push({
      code: 'server-workflows-invalid',
      message: 'Server workflows are invalid and were omitted from generated output.'
    })
    return undefined
  }
  return parsed.workflows ? [...parsed.workflows] : undefined
}

function lowerWorkflow(workflow: ServerWorkflowDef): IRServerWorkflow {
  return {
    id: workflow.id,
    name: workflow.name,
    params: workflow.params ?? [],
    actions: workflow.actions.map(lowerAction)
  }
}

function expression(source: string): { ast: ExprAst; references: string[] } {
  const parsed = parseExpression(source)
  if (!parsed.ok) throw new Error('validated server expression failed to parse')
  return { ast: parsed.ast, references: [...parsed.references] }
}

function lowerValue(source: ServerValueSource): IRServerValueSource {
  if (source.kind === 'env') return source
  return { kind: 'expr', ...expression(source.expr) }
}

function filtersOf(
  filters: Extract<ServerActionDef, { kind: 'supabaseQuery' | 'supabaseMutation' }>['filters']
): IRServerSupabaseFilter[] {
  return (filters ?? []).map((filter) => ({
    column: filter.column,
    op: filter.op,
    value: { kind: 'expr', ...expression(filter.valueExpr) }
  }))
}

function payloadOf(
  entries: Extract<ServerActionDef, { kind: 'supabaseMutation' }>['payloadEntries']
): IRServerPayloadEntry[] | undefined {
  if (!entries) return undefined
  return entries.map((entry) => ({
    key: entry.key,
    value: { kind: 'expr', ...expression(entry.valueExpr) }
  }))
}

function argsOf(args: Record<string, string> | undefined): IRServerPayloadEntry[] {
  return Object.entries(args ?? {})
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, source]) => ({
      key,
      value: { kind: 'expr', ...expression(source) }
    }))
}

function lowerAction(action: ServerActionDef): IRServerAction {
  switch (action.kind) {
    case 'httpRequest':
      return {
        kind: action.kind,
        method: action.method,
        url: lowerValue(action.url),
        ...(action.headers
          ? {
              headers: action.headers.map((header) => ({
                ...header,
                value: lowerValue(header.value)
              }))
            }
          : {}),
        ...(action.body ? { body: lowerValue(action.body) } : {}),
        ...(action.resultName ? { resultName: action.resultName } : {})
      }
    case 'supabaseQuery':
      return {
        kind: action.kind,
        table: action.table,
        columns: action.columns ?? '*',
        filters: filtersOf(action.filters),
        single: action.single === true,
        resultName: action.resultName
      }
    case 'supabaseMutation':
      return {
        kind: action.kind,
        operation: action.operation,
        table: action.table,
        ...(action.payloadEntries ? { payloadEntries: payloadOf(action.payloadEntries) } : {}),
        filters: filtersOf(action.filters),
        ...(action.resultName ? { resultName: action.resultName } : {})
      }
    case 'condition': {
      const condition = expression(action.condExpr)
      return {
        kind: action.kind,
        condAst: condition.ast,
        references: condition.references,
        consequent: action.consequent.map(lowerAction),
        ...(action.alternate ? { alternate: action.alternate.map(lowerAction) } : {})
      }
    }
    case 'return': {
      const value = action.valueExpr ? expression(action.valueExpr) : undefined
      return {
        kind: action.kind,
        ...(value ? { valueAst: value.ast } : {}),
        references: value?.references ?? [],
        status: action.status ?? 200
      }
    }
    case 'callServerWorkflow':
      return {
        kind: action.kind,
        workflowId: action.workflowId,
        args: argsOf(action.args)
      }
  }
  const exhaustive: never = action
  throw new Error(`unhandled server action kind: ${JSON.stringify(exhaustive)}`)
}
