import type {
  BackendDataFilterIR,
  BackendDataValueIR,
  BackendSecretRef,
  BackendValueSource,
  BackendWorkflowDefinitionIR,
  BackendWorkflowStepIR,
  DataEntityIR,
  DataModelIR
} from './types'
import type { BackendValidationContext } from './validation-helpers'

type WorkflowDataStep = Extract<BackendWorkflowStepIR, { kind: 'data.read' | 'data.mutate' }>

export function validateWorkflowMutationShape(
  operation: Extract<BackendWorkflowStepIR, { kind: 'data.mutate' }>['operation'],
  values: readonly BackendDataValueIR[] | undefined,
  filters: readonly BackendDataFilterIR[] | undefined,
  path: string,
  context: BackendValidationContext
): boolean {
  const hasValues = Boolean(values?.length)
  const hasFilters = Boolean(filters?.length)
  let safe = hasFilters
  if (operation === 'insert' || operation === 'upsert') safe = hasValues
  else if (operation === 'update') safe = hasValues && hasFilters
  if (!safe) {
    context.diagnostics.push({
      code: 'backend-workflow-mutation-unsafe',
      severity: 'error',
      path,
      message:
        'Insert and upsert require values; update requires values and filters; delete requires filters.'
    })
  }
  return safe
}

function walkWorkflowSteps(
  steps: readonly BackendWorkflowStepIR[],
  path: string,
  visit: (step: BackendWorkflowStepIR, path: string) => void
): void {
  for (const [index, step] of steps.entries()) {
    const stepPath = `${path}[${index}]`
    visit(step, stepPath)
    if (step.kind === 'branch') {
      walkWorkflowSteps(step.consequent, `${stepPath}.consequent`, visit)
      walkWorkflowSteps(step.alternate, `${stepPath}.alternate`, visit)
    }
  }
}

function walkWorkflows(
  workflows: readonly BackendWorkflowDefinitionIR[],
  visit: (step: BackendWorkflowStepIR, path: string) => void
): void {
  for (const [index, workflow] of workflows.entries()) {
    walkWorkflowSteps(workflow.steps, `$.workflows.workflows[${index}].steps`, visit)
  }
}

function missingManagedField(
  fieldId: string,
  fieldIds: ReadonlySet<string>,
  path: string,
  context: BackendValidationContext
): void {
  if (fieldIds.has(fieldId)) return
  context.diagnostics.push({
    code: 'backend-workflow-field-missing',
    severity: 'error',
    path,
    message: 'Workflow data references must use a field id declared by the managed entity.'
  })
}

function validateFilterFields(
  filters: readonly BackendDataFilterIR[],
  fieldIds: ReadonlySet<string>,
  path: string,
  context: BackendValidationContext
): void {
  for (const [index, filter] of filters.entries()) {
    missingManagedField(filter.field, fieldIds, `${path}[${index}].field`, context)
  }
}

function validateValueFields(
  values: readonly BackendDataValueIR[],
  fieldIds: ReadonlySet<string>,
  path: string,
  context: BackendValidationContext
): void {
  for (const [index, value] of values.entries()) {
    missingManagedField(value.field, fieldIds, `${path}[${index}].field`, context)
  }
}

function validateMutationInsertCoverage(
  step: Extract<BackendWorkflowStepIR, { kind: 'data.mutate' }>,
  entity: DataEntityIR,
  path: string,
  context: BackendValidationContext
): void {
  if (step.operation !== 'insert' && step.operation !== 'upsert') return
  const providedFields = new Set((step.values ?? []).map((value) => value.field))
  for (const field of entity.fields) {
    if (field.nullable || field.default !== undefined || providedFields.has(field.id)) continue
    context.diagnostics.push({
      code: 'backend-workflow-required-field-missing',
      severity: 'error',
      path: `${path}.values.${field.id}`,
      message:
        'Managed insert and upsert steps must provide every non-null field without a default.'
    })
  }
  if (step.operation !== 'upsert') return
  const primaryKeyFields = entity.primaryKey?.fields
  if (!primaryKeyFields?.length) {
    context.diagnostics.push({
      code: 'backend-workflow-upsert-primary-key-missing',
      severity: 'error',
      path: `${path}.entityId`,
      message: 'Managed upsert steps require the target entity to declare a primary key.'
    })
    return
  }
  for (const fieldId of primaryKeyFields) {
    if (providedFields.has(fieldId)) continue
    context.diagnostics.push({
      code: 'backend-workflow-upsert-key-missing',
      severity: 'error',
      path: `${path}.values.${fieldId}`,
      message: 'Managed upsert steps must provide every primary-key field.'
    })
  }
}

function warnExternalSchema(path: string, context: BackendValidationContext): void {
  context.diagnostics.push({
    code: 'backend-workflow-external-schema-unverified',
    severity: 'warning',
    path: `${path}.entityId`,
    message:
      'External entity fields are not declared in Backend IR; Manual/Live schema verification is required before release.'
  })
}

function validateManagedDataFields(
  step: WorkflowDataStep,
  entity: DataEntityIR,
  path: string,
  context: BackendValidationContext
): void {
  if (entity.management === 'external') {
    warnExternalSchema(path, context)
    return
  }
  const fieldIds = new Set(entity.fields.map((field) => field.id))
  if (step.kind === 'data.read') {
    for (const [index, fieldId] of (step.fields ?? []).entries()) {
      missingManagedField(fieldId, fieldIds, `${path}.fields[${index}]`, context)
    }
    validateFilterFields(step.filters ?? [], fieldIds, `${path}.filters`, context)
    return
  }
  validateValueFields(step.values ?? [], fieldIds, `${path}.values`, context)
  validateFilterFields(step.filters ?? [], fieldIds, `${path}.filters`, context)
  validateMutationInsertCoverage(step, entity, path, context)
}

export function validateWorkflowDataReferences(
  workflows: readonly BackendWorkflowDefinitionIR[],
  model: DataModelIR,
  context: BackendValidationContext
): void {
  const entities = new Map(model.entities.map((entity) => [entity.id, entity]))
  walkWorkflows(workflows, (step, path) => {
    if (step.kind !== 'data.read' && step.kind !== 'data.mutate') return
    const entity = entities.get(step.entityId)
    if (entity) validateManagedDataFields(step, entity, path, context)
  })
}

function environmentSources(
  step: BackendWorkflowStepIR,
  path: string
): readonly [BackendValueSource, string][] {
  if (step.kind === 'data.read') {
    return (step.filters ?? []).map((filter, index) => [
      filter.value,
      `${path}.filters[${index}].value`
    ])
  }
  if (step.kind === 'data.mutate') {
    return [
      ...(step.values ?? []).map((value, index): [BackendValueSource, string] => [
        value.value,
        `${path}.values[${index}].value`
      ]),
      ...(step.filters ?? []).map((filter, index): [BackendValueSource, string] => [
        filter.value,
        `${path}.filters[${index}].value`
      ])
    ]
  }
  if (step.kind === 'http.request') {
    return [
      [step.url, `${path}.url`],
      ...(step.body
        ? ([[step.body, `${path}.body`] as [BackendValueSource, string]] as const)
        : []),
      ...(step.headers ?? []).map((header, index): [BackendValueSource, string] => [
        header.value,
        `${path}.headers[${index}].value`
      ])
    ]
  }
  return []
}

export function validateWorkflowEnvironmentReferences(
  workflows: readonly BackendWorkflowDefinitionIR[],
  secrets: readonly BackendSecretRef[],
  context: BackendValidationContext
): void {
  const declared = new Set(
    secrets.filter((secret) => secret.kind === 'environment').map((secret) => secret.name)
  )
  walkWorkflows(workflows, (step, path) => {
    for (const [source, sourcePath] of environmentSources(step, path)) {
      if (source.kind !== 'environment' || declared.has(source.name)) continue
      context.diagnostics.push({
        code: 'backend-workflow-environment-undeclared',
        severity: 'error',
        path: `${sourcePath}.name`,
        message:
          'Workflow environment references must match an application secret declared with kind environment.'
      })
    }
  })
}
