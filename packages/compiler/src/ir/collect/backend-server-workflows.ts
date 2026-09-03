import { parseExpression } from '@open-pencil/lowcode'
import type {
  BackendApplicationSpecV1,
  BackendValueSource,
  BackendWorkflowDefinitionIR,
  BackendWorkflowStepIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import type {
  IRServerAction,
  IRServerPayloadEntry,
  IRServerSupabaseFilter,
  IRServerValueSource,
  IRServerWorkflow
} from '../types'
import { parseServerWorkflows } from './server-workflows'

export type ServerWorkflowAuthorityResult =
  | Readonly<{ ok: true; workflows?: readonly IRServerWorkflow[] }>
  | Readonly<{ ok: false }>

function expression(source: string): Extract<IRServerValueSource, { kind: 'expr' }> {
  const parsed = parseExpression(source)
  if (!parsed.ok) throw new TypeError('Normalized Backend workflow expression is invalid.')
  return { kind: 'expr', ast: parsed.ast, references: [...parsed.references] }
}

function value(source: BackendValueSource): IRServerValueSource {
  return source.kind === 'environment'
    ? { kind: 'env', name: source.name }
    : expression(source.expression)
}

function entity(application: BackendApplicationSpecV1, entityId: string): DataEntityIR {
  const found = application.dataModel.entities.find((entry) => entry.id === entityId)
  if (!found) throw new TypeError('Normalized Backend workflow entity is unavailable.')
  return found
}

function fieldName(
  application: BackendApplicationSpecV1,
  entityId: string,
  fieldId: string
): string {
  const owner = entity(application, entityId)
  if (owner.management === 'external') return fieldId
  const found = owner.fields.find((entry) => entry.id === fieldId)
  if (!found) throw new TypeError('Normalized Backend workflow field is unavailable.')
  return found.name
}

function filters(
  application: BackendApplicationSpecV1,
  step: Extract<BackendWorkflowStepIR, { kind: 'data.read' | 'data.mutate' }>
): IRServerSupabaseFilter[] {
  return (step.filters ?? []).map((filter) => ({
    column: fieldName(application, step.entityId, filter.field),
    op: filter.operator,
    value: value(filter.value)
  }))
}

function entries(
  application: BackendApplicationSpecV1,
  step: Extract<BackendWorkflowStepIR, { kind: 'data.mutate' }>
): IRServerPayloadEntry[] | undefined {
  if (!step.values) return undefined
  return step.values.map((entry) => ({
    key: fieldName(application, step.entityId, entry.field),
    value: value(entry.value)
  }))
}

function callArgs(
  application: BackendApplicationSpecV1,
  workflowId: string
): IRServerPayloadEntry[] {
  const target = application.workflows.workflows.find((workflow) => workflow.id === workflowId)
  if (!target) throw new TypeError('Normalized Backend workflow call target is unavailable.')
  return [...target.parameters]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((name) => ({ key: name, value: expression(name) }))
}

function lowerStep(
  application: BackendApplicationSpecV1,
  step: BackendWorkflowStepIR
): IRServerAction {
  switch (step.kind) {
    case 'data.read':
      return {
        kind: 'supabaseQuery',
        table: entity(application, step.entityId).name,
        columns: step.fields?.length
          ? step.fields.map((field) => fieldName(application, step.entityId, field)).join(',')
          : '*',
        filters: filters(application, step),
        single: step.single === true,
        resultName: step.resultName
      }
    case 'data.mutate':
      return {
        kind: 'supabaseMutation',
        operation: step.operation,
        table: entity(application, step.entityId).name,
        ...(step.values ? { payloadEntries: entries(application, step) } : {}),
        filters: filters(application, step),
        ...(step.resultName ? { resultName: step.resultName } : {})
      }
    case 'http.request':
      return {
        kind: 'httpRequest',
        method: step.method,
        url: value(step.url),
        ...(step.headers
          ? {
              headers: step.headers.map((header) => ({
                name: header.name,
                value: value(header.value)
              }))
            }
          : {}),
        ...(step.body ? { body: value(step.body) } : {}),
        ...(step.resultName ? { resultName: step.resultName } : {})
      }
    case 'branch': {
      const condition = expression(step.condition)
      const alternate = step.alternate.map((entry) => lowerStep(application, entry))
      return {
        kind: 'condition',
        condAst: condition.ast,
        references: condition.references,
        consequent: step.consequent.map((entry) => lowerStep(application, entry)),
        ...(alternate.length > 0 ? { alternate } : {})
      }
    }
    case 'respond': {
      const response = step.value ? expression(step.value) : undefined
      return {
        kind: 'return',
        ...(response ? { valueAst: response.ast } : {}),
        references: response?.references ?? [],
        status: step.status ?? 200
      }
    }
    case 'call':
      return {
        kind: 'callServerWorkflow',
        workflowId: step.workflowId,
        args: callArgs(application, step.workflowId)
      }
  }
  const exhaustive: never = step
  throw new TypeError(`Unsupported Backend workflow step: ${JSON.stringify(exhaustive)}`)
}

function lowerWorkflow(
  application: BackendApplicationSpecV1,
  workflow: BackendWorkflowDefinitionIR
): IRServerWorkflow {
  return {
    id: workflow.id,
    name: workflow.name,
    params: [...workflow.parameters],
    actions: workflow.steps.map((step) => lowerStep(application, step))
  }
}

function lowerApplicationWorkflows(
  application: BackendApplicationSpecV1
): readonly IRServerWorkflow[] | undefined {
  if (application.workflows.workflows.length === 0) return undefined
  return application.workflows.workflows.map((workflow) => lowerWorkflow(application, workflow))
}

interface CanonicalObject {
  [key: string]: unknown
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as CanonicalObject)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, entry]) => [key, canonical(entry)])
  )
}

function sameWorkflows(
  explicit: readonly IRServerWorkflow[] | undefined,
  legacy: readonly IRServerWorkflow[] | undefined
): boolean {
  const ordered = (workflows: readonly IRServerWorkflow[] | undefined) =>
    [...(workflows ?? [])].sort((left, right) => left.id.localeCompare(right.id, 'en'))
  return JSON.stringify(canonical(ordered(explicit))) === JSON.stringify(canonical(ordered(legacy)))
}

/** Resolve exactly one server-workflow authority. A normalized Backend
 * application wins; the legacy root declaration is accepted only when it is a
 * byte-independent semantic mirror of the same lowered workflows. */
export function resolveServerWorkflowAuthority(
  application: BackendApplicationSpecV1 | undefined,
  legacyRaw: unknown
): ServerWorkflowAuthorityResult {
  if (!application) return parseServerWorkflows(legacyRaw)
  try {
    const explicit = lowerApplicationWorkflows(application)
    if (legacyRaw === undefined) return { ok: true, workflows: explicit }
    const legacy = parseServerWorkflows(legacyRaw)
    if (!legacy.ok || !sameWorkflows(explicit, legacy.workflows)) return { ok: false }
    return { ok: true, workflows: explicit }
  } catch {
    return { ok: false }
  }
}
