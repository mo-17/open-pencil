import { computed, ref } from 'vue'

import {
  BACKEND_LIMITS,
  type BackendApplicationSpecV1,
  type BackendDataFilterIR,
  type BackendDataValueIR,
  type BackendValueSource,
  type BackendWorkflowDefinitionIR,
  type BackendWorkflowStepIR,
  type DataFieldIR
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import {
  BackendDraftOperationError,
  addBackendWorkflowStep,
  canAddBackendWorkflowStep,
  setBackendWorkflowMutationValueField,
  setBackendWorkflowStepEntity,
  type BackendWorkflowStepKind
} from './draft'

export interface BackendWorkflowStepsProps {
  readonly application: BackendApplicationSpecV1
  readonly workflow: BackendWorkflowDefinitionIR
  readonly steps: BackendWorkflowStepIR[]
  readonly depth: number
}

export function useBackendWorkflowSteps(props: BackendWorkflowStepsProps) {
  const { panels } = useI18n()
  const operationError = ref('')
  const stepKinds = Object.freeze([
    'data.read',
    'data.mutate',
    'http.request',
    'branch',
    'call',
    'respond'
  ] as const satisfies readonly BackendWorkflowStepKind[])
  const filterOperators = Object.freeze([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'like',
    'in'
  ] as const satisfies readonly BackendDataFilterIR['operator'][])
  const environmentNames = computed(() =>
    props.application.secrets
      .filter(
        (secret) => secret.kind === 'environment' && secret.exposure === 'server' && secret.required
      )
      .map((secret) => secret.name)
      .sort((left, right) => left.localeCompare(right, 'en'))
  )
  const entityOptions = computed(() => props.application.dataModel.entities)
  const mutableEntityOptions = computed(() =>
    props.application.dataModel.entities.filter(
      (entity) => entity.management === 'managed' && entity.fields.length > 0
    )
  )

  type DataMutateStep = Extract<BackendWorkflowStepIR, { kind: 'data.mutate' }>
  type HttpRequestStep = Extract<BackendWorkflowStepIR, { kind: 'http.request' }>

  function run(operation: () => void): void {
    operationError.value = ''
    try {
      operation()
    } catch (cause) {
      operationError.value =
        cause instanceof BackendDraftOperationError
          ? cause.message
          : panels.value.lowcodeBackendOperationError
    }
  }

  function removeById<T extends { id: string }>(entries: T[], id: string): void {
    const index = entries.findIndex((entry) => entry.id === id)
    if (index !== -1) entries.splice(index, 1)
  }

  function canAddStep(
    workflow: BackendWorkflowDefinitionIR,
    kind: BackendWorkflowStepKind
  ): boolean {
    if (!canAddBackendWorkflowStep(props.application, workflow, kind, props.steps)) return false
    if (kind === 'data.read') return entityOptions.value.length > 0
    if (kind === 'data.mutate') return mutableEntityOptions.value.length > 0
    if (kind === 'call') {
      return props.application.workflows.workflows.some((candidate) => candidate.id !== workflow.id)
    }
    return true
  }

  function addStep(workflow: BackendWorkflowDefinitionIR, kind: BackendWorkflowStepKind): void {
    run(() => addBackendWorkflowStep(props.application, workflow, kind, undefined, props.steps))
  }

  function responseValue(step: Extract<BackendWorkflowStepIR, { kind: 'respond' }>): string {
    return step.value ?? ''
  }

  function updateResponse(
    step: Extract<BackendWorkflowStepIR, { kind: 'respond' }>,
    value: string
  ): void {
    const trimmed = value.trim()
    if (trimmed) step.value = trimmed
    else delete step.value
  }

  function updateResponseStatus(
    step: Extract<BackendWorkflowStepIR, { kind: 'respond' }>,
    value: string
  ): void {
    run(() => {
      const status = Number(value)
      if (!Number.isSafeInteger(status) || status < 200 || status > 599) {
        throw new BackendDraftOperationError('Response status must be an integer from 200 to 599.')
      }
      step.status = status
    })
  }

  function fieldsForEntity(entityId: string): readonly DataFieldIR[] {
    return (
      props.application.dataModel.entities.find((entity) => entity.id === entityId)?.fields ?? []
    )
  }

  function updateOptionalResultName(step: DataMutateStep | HttpRequestStep, value: string): void {
    const trimmed = value.trim()
    if (trimmed) step.resultName = trimmed
    else delete step.resultName
  }

  function sourceText(source: BackendValueSource): string {
    return source.kind === 'expression' ? source.expression : source.name
  }

  function updateSourceText(source: BackendValueSource, value: string): void {
    if (source.kind === 'expression') source.expression = value
    else source.name = value
  }

  function replacementSource(kind: BackendValueSource['kind']): BackendValueSource {
    return kind === 'expression'
      ? { kind, expression: '$currentUser.id' }
      : { kind, name: environmentNames.value[0] ?? '' }
  }

  function setHttpURLKind(step: HttpRequestStep, kind: BackendValueSource['kind']): void {
    if (step.url.kind !== kind) step.url = replacementSource(kind)
  }

  function setHttpBodyKind(step: HttpRequestStep, kind: BackendValueSource['kind']): void {
    if (!step.body || step.body.kind !== kind) step.body = replacementSource(kind)
  }

  function toggleHttpBody(step: HttpRequestStep, enabled: boolean): void {
    if (enabled) step.body ??= { kind: 'expression', expression: '$currentUser.id' }
    else delete step.body
  }

  function setMutationValueKind(entry: BackendDataValueIR, kind: BackendValueSource['kind']): void {
    if (entry.value.kind !== kind) entry.value = replacementSource(kind)
  }

  function addMutationValue(step: DataMutateStep): void {
    run(() => {
      const used = new Set((step.values ?? []).map((entry) => entry.field))
      const field = fieldsForEntity(step.entityId).find((candidate) => !used.has(candidate.id))
      if (!field) {
        throw new BackendDraftOperationError('Every field already has a mutation value.')
      }
      step.values = [
        ...(step.values ?? []),
        { field: field.id, value: { kind: 'expression', expression: '$currentUser.id' } }
      ]
    })
  }

  function changeMutationValueField(step: DataMutateStep, index: number, fieldId: string): void {
    run(() => setBackendWorkflowMutationValueField(props.application, step, index, fieldId))
  }

  function removeMutationValue(step: DataMutateStep, index: number): void {
    step.values?.splice(index, 1)
    if (step.values?.length === 0) delete step.values
  }

  function mutationValueRemovalLocked(step: DataMutateStep): boolean {
    return step.operation !== 'delete' && (step.values?.length ?? 0) === 1
  }

  type DataStep = Extract<BackendWorkflowStepIR, { kind: 'data.read' | 'data.mutate' }>

  function addFilter(step: DataStep): void {
    run(() => {
      const fields = fieldsForEntity(step.entityId)
      const field = fields[0]
      if (!field) throw new BackendDraftOperationError('Select an entity with a field first.')
      if ((step.filters?.length ?? 0) >= BACKEND_LIMITS.maxFieldsPerEntity) {
        throw new BackendDraftOperationError(
          `Workflow filters are limited to ${BACKEND_LIMITS.maxFieldsPerEntity} items.`
        )
      }
      step.filters = [
        ...(step.filters ?? []),
        {
          field: field.id,
          operator: 'eq',
          value: { kind: 'expression', expression: '$currentUser.id' }
        }
      ]
    })
  }

  function removeFilter(step: DataStep, index: number): void {
    step.filters?.splice(index, 1)
    if (step.filters?.length === 0) delete step.filters
  }

  function filterRemovalLocked(step: DataStep): boolean {
    return (
      step.kind === 'data.mutate' &&
      (step.operation === 'update' || step.operation === 'delete') &&
      (step.filters?.length ?? 0) === 1
    )
  }

  function setFilterValueKind(filter: BackendDataFilterIR, kind: BackendValueSource['kind']): void {
    if (filter.value.kind !== kind) filter.value = replacementSource(kind)
  }

  function changeDataEntity(step: DataStep, entityId: string): void {
    run(() => setBackendWorkflowStepEntity(props.application, step, entityId))
  }

  function changeMutationOperation(
    step: DataMutateStep,
    operation: DataMutateStep['operation']
  ): void {
    step.operation = operation
    if (operation !== 'delete' && !step.values?.length) addMutationValue(step)
    if ((operation === 'update' || operation === 'delete') && !step.filters?.length) {
      addFilter(step)
    }
  }

  function callTargets(
    workflow: BackendWorkflowDefinitionIR,
    step: Extract<BackendWorkflowStepIR, { kind: 'call' }>
  ): readonly BackendWorkflowDefinitionIR[] {
    const targets = props.application.workflows.workflows.filter(
      (candidate) => candidate.id !== workflow.id
    )
    if (targets.some((candidate) => candidate.id === step.workflowId)) return targets
    return [
      ...targets,
      {
        id: step.workflowId,
        name: step.workflowId,
        trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
        parameters: [],
        steps: []
      }
    ]
  }

  function stepLabel(kind: BackendWorkflowStepKind): string {
    if (kind === 'data.read') return panels.value.lowcodeBackendAddDataRead
    if (kind === 'data.mutate') return panels.value.lowcodeBackendAddDataMutate
    if (kind === 'http.request') return panels.value.lowcodeBackendAddHttpRequest
    if (kind === 'branch') return panels.value.lowcodeBackendAddBranch
    if (kind === 'call') return panels.value.lowcodeBackendAddCall
    return panels.value.lowcodeBackendAddResponse
  }

  return {
    panels,
    operationError,
    stepKinds,
    filterOperators,
    environmentNames,
    entityOptions,
    mutableEntityOptions,
    removeById,
    canAddStep,
    addStep,
    responseValue,
    updateResponse,
    updateResponseStatus,
    fieldsForEntity,
    updateOptionalResultName,
    sourceText,
    updateSourceText,
    setHttpURLKind,
    setHttpBodyKind,
    toggleHttpBody,
    setMutationValueKind,
    addMutationValue,
    changeMutationValueField,
    removeMutationValue,
    mutationValueRemovalLocked,
    addFilter,
    removeFilter,
    filterRemovalLocked,
    setFilterValueKind,
    changeDataEntity,
    changeMutationOperation,
    callTargets,
    stepLabel
  }
}
