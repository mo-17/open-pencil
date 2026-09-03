<script setup lang="ts">
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
  addBackendWorkflow,
  addBackendWorkflowStep,
  removeBackendWorkflow,
  setBackendWorkflowMutationValueField,
  setBackendWorkflowStepEntity,
  type BackendWorkflowStepKind
} from '../draft'

const { application } = defineProps<{ application: BackendApplicationSpecV1 }>()
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
  application.secrets
    .filter(
      (secret) => secret.kind === 'environment' && secret.exposure === 'server' && secret.required
    )
    .map((secret) => secret.name)
    .sort((left, right) => left.localeCompare(right, 'en'))
)
const entityOptions = computed(() => application.dataModel.entities)
const mutableEntityOptions = computed(() =>
  application.dataModel.entities.filter(
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

function parameters(workflow: BackendWorkflowDefinitionIR): string {
  return workflow.parameters.join(', ')
}

function updateParameters(workflow: BackendWorkflowDefinitionIR, value: string): void {
  run(() => {
    const parameters = [
      ...new Set(
        value
          .split(',')
          .map((parameter) => parameter.trim())
          .filter(Boolean)
      )
    ]
    if (parameters.length > 64) {
      throw new BackendDraftOperationError('Workflow parameters are limited to 64 items.')
    }
    workflow.parameters = parameters
  })
}

function canAddStep(workflow: BackendWorkflowDefinitionIR, kind: BackendWorkflowStepKind): boolean {
  if (kind === 'data.read') return entityOptions.value.length > 0
  if (kind === 'data.mutate') return mutableEntityOptions.value.length > 0
  if (kind === 'call') {
    return application.workflows.workflows.some((candidate) => candidate.id !== workflow.id)
  }
  return true
}

function addStep(workflow: BackendWorkflowDefinitionIR, kind: BackendWorkflowStepKind): void {
  run(() => addBackendWorkflowStep(application, workflow, kind))
}

function removeWorkflow(workflowId: string): void {
  run(() => removeBackendWorkflow(application, workflowId))
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
  return application.dataModel.entities.find((entity) => entity.id === entityId)?.fields ?? []
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
  run(() => setBackendWorkflowMutationValueField(application, step, index, fieldId))
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
  run(() => setBackendWorkflowStepEntity(application, step, entityId))
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
  const targets = application.workflows.workflows.filter(
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
</script>

<template>
  <div class="mt-2 flex flex-col gap-2" data-test-id="lowcode-backend-workflows">
    <div class="flex items-center justify-between">
      <span class="text-[10px] text-muted">{{ panels.lowcodeBackendTabWorkflows }}</span>
      <button
        type="button"
        data-test-id="lowcode-backend-add-workflow"
        :disabled="application.workflows.workflows.length >= BACKEND_LIMITS.maxWorkflows"
        class="rounded px-1 text-[10px] text-muted hover:bg-hover"
        @click="run(() => addBackendWorkflow(application))"
      >
        {{ panels.lowcodeBackendAddWorkflow }}
      </button>
    </div>
    <p v-if="application.workflows.workflows.length === 0" class="text-[10px] text-muted">
      {{ panels.lowcodeBackendNoWorkflows }}
    </p>
    <div
      v-for="workflow in application.workflows.workflows"
      :key="workflow.id"
      data-test-id="lowcode-backend-workflow"
      class="rounded border border-border p-2"
    >
      <div class="flex items-center gap-1">
        <input
          v-model="workflow.name"
          maxlength="128"
          :aria-label="panels.lowcodeBackendWorkflowName"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-[10px] text-surface"
        /><button
          type="button"
          :aria-label="panels.lowcodeBackendRemoveWorkflow"
          class="px-1 text-muted hover:text-red-500"
          @click="removeWorkflow(workflow.id)"
        >
          ×
        </button>
      </div>
      <p class="mt-1 text-[9px] text-muted">{{ panels.lowcodeBackendWorkflowTrigger }}</p>
      <input
        :value="parameters(workflow)"
        maxlength="4095"
        :aria-label="panels.lowcodeBackendWorkflowParameters"
        :placeholder="panels.lowcodeBackendWorkflowParameters"
        class="mt-1 w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
        @change="updateParameters(workflow, ($event.target as HTMLInputElement).value)"
      />
      <div
        v-for="step in workflow.steps"
        :key="step.id"
        :data-test-id="`lowcode-backend-workflow-step-${step.kind}`"
        class="mt-1.5 rounded border border-border/70 p-1.5"
      >
        <div class="flex items-center justify-between">
          <span class="font-mono text-[9px] text-muted">{{ step.kind }}</span
          ><button
            type="button"
            :aria-label="panels.lowcodeBackendRemoveStep"
            class="px-1 text-muted hover:text-red-500"
            @click="removeById(workflow.steps, step.id)"
          >
            ×
          </button>
        </div>

        <div v-if="step.kind === 'data.read'" class="mt-1 flex flex-col gap-1">
          <select
            :value="step.entityId"
            :aria-label="panels.lowcodeBackendEntity"
            class="w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
            @change="changeDataEntity(step, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="entity in entityOptions" :key="entity.id" :value="entity.id">
              {{ entity.name }}
            </option>
          </select>
          <div class="grid grid-cols-[1fr_auto] gap-1">
            <input
              v-model="step.resultName"
              maxlength="63"
              :aria-label="panels.lowcodeBackendWorkflowResultName"
              :placeholder="panels.lowcodeBackendWorkflowResultName"
              class="min-w-0 rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
            />
            <label class="flex items-center gap-1 text-[9px] text-muted">
              <input v-model="step.single" type="checkbox" />
              {{ panels.lowcodeBackendWorkflowSingle }}
            </label>
          </div>
          <p v-if="step.fields?.length" class="text-[9px] text-muted">
            {{ panels.lowcodeBackendWorkflowComplexPreserved }}
          </p>
        </div>

        <div v-else-if="step.kind === 'data.mutate'" class="mt-1 flex flex-col gap-1">
          <div class="grid grid-cols-2 gap-1">
            <select
              :value="step.entityId"
              :aria-label="panels.lowcodeBackendEntity"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
              @change="changeDataEntity(step, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="entity in mutableEntityOptions" :key="entity.id" :value="entity.id">
                {{ entity.name }}
              </option>
            </select>
            <select
              :value="step.operation"
              :aria-label="panels.lowcodeBackendWorkflowMutationOperation"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
              @change="
                changeMutationOperation(
                  step,
                  ($event.target as HTMLSelectElement).value as DataMutateStep['operation']
                )
              "
            >
              <option value="insert">insert</option>
              <option value="update">update</option>
              <option value="delete">delete</option>
              <option value="upsert">upsert</option>
            </select>
          </div>
          <input
            :value="step.resultName ?? ''"
            maxlength="63"
            :aria-label="panels.lowcodeBackendWorkflowResultName"
            :placeholder="panels.lowcodeBackendWorkflowOptionalResultName"
            class="w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
            @change="updateOptionalResultName(step, ($event.target as HTMLInputElement).value)"
          />
          <div
            v-for="(entry, index) in step.values ?? []"
            :key="`${step.id}:value:${index}`"
            class="grid grid-cols-[1fr_86px_1fr_auto] gap-1"
          >
            <select
              :value="entry.field"
              :aria-label="panels.lowcodeBackendWorkflowValueField"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
              @change="
                changeMutationValueField(step, index, ($event.target as HTMLSelectElement).value)
              "
            >
              <option
                v-for="field in fieldsForEntity(step.entityId)"
                :key="field.id"
                :value="field.id"
              >
                {{ field.name }}
              </option>
            </select>
            <select
              :value="entry.value.kind"
              :aria-label="panels.lowcodeBackendWorkflowValueSource"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
              @change="
                setMutationValueKind(
                  entry,
                  ($event.target as HTMLSelectElement).value as BackendValueSource['kind']
                )
              "
            >
              <option value="expression">{{ panels.lowcodeBackendWorkflowExpression }}</option>
              <option v-if="environmentNames.length" value="environment">
                {{ panels.lowcodeBackendWorkflowEnvironment }}
              </option>
            </select>
            <input
              v-if="entry.value.kind === 'expression'"
              :value="sourceText(entry.value)"
              maxlength="1024"
              :aria-label="panels.lowcodeBackendWorkflowExpression"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 font-mono text-[9px] text-surface"
              @change="updateSourceText(entry.value, ($event.target as HTMLInputElement).value)"
            />
            <select
              v-else
              :value="entry.value.name"
              :aria-label="panels.lowcodeBackendWorkflowEnvironment"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
              @change="updateSourceText(entry.value, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="name in environmentNames" :key="name" :value="name">{{ name }}</option>
            </select>
            <button
              type="button"
              :aria-label="panels.lowcodeBackendRemoveRule"
              :disabled="mutationValueRemovalLocked(step)"
              class="px-1 text-muted hover:text-red-500"
              @click="removeMutationValue(step, index)"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            class="self-start rounded px-1 text-[9px] text-muted hover:bg-hover"
            @click="addMutationValue(step)"
          >
            {{ panels.lowcodeBackendWorkflowAddValue }}
          </button>
        </div>

        <div v-else-if="step.kind === 'http.request'" class="mt-1 flex flex-col gap-1">
          <div class="grid grid-cols-[72px_86px_1fr] gap-1">
            <select
              v-model="step.method"
              :aria-label="panels.lowcodeBackendWorkflowHttpMethod"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <select
              :value="step.url.kind"
              :aria-label="panels.lowcodeBackendWorkflowValueSource"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
              @change="
                setHttpURLKind(
                  step,
                  ($event.target as HTMLSelectElement).value as BackendValueSource['kind']
                )
              "
            >
              <option value="expression">{{ panels.lowcodeBackendWorkflowExpression }}</option>
              <option v-if="environmentNames.length" value="environment">
                {{ panels.lowcodeBackendWorkflowEnvironment }}
              </option>
            </select>
            <input
              v-if="step.url.kind === 'expression'"
              :value="step.url.expression"
              maxlength="1024"
              :aria-label="panels.lowcodeBackendWorkflowHttpUrl"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 font-mono text-[9px] text-surface"
              @change="updateSourceText(step.url, ($event.target as HTMLInputElement).value)"
            />
            <select
              v-else
              :value="step.url.name"
              :aria-label="panels.lowcodeBackendWorkflowHttpUrl"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
              @change="updateSourceText(step.url, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="name in environmentNames" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>
          <input
            :value="step.resultName ?? ''"
            maxlength="63"
            :aria-label="panels.lowcodeBackendWorkflowResultName"
            :placeholder="panels.lowcodeBackendWorkflowOptionalResultName"
            class="w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
            @change="updateOptionalResultName(step, ($event.target as HTMLInputElement).value)"
          />
          <label class="flex items-center gap-1 text-[9px] text-muted">
            <input
              type="checkbox"
              :checked="Boolean(step.body)"
              @change="toggleHttpBody(step, ($event.target as HTMLInputElement).checked)"
            />
            {{ panels.lowcodeBackendWorkflowHttpBody }}
          </label>
          <div v-if="step.body" class="grid grid-cols-[86px_1fr] gap-1">
            <select
              :value="step.body.kind"
              :aria-label="panels.lowcodeBackendWorkflowValueSource"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
              @change="
                setHttpBodyKind(
                  step,
                  ($event.target as HTMLSelectElement).value as BackendValueSource['kind']
                )
              "
            >
              <option value="expression">{{ panels.lowcodeBackendWorkflowExpression }}</option>
              <option v-if="environmentNames.length" value="environment">
                {{ panels.lowcodeBackendWorkflowEnvironment }}
              </option>
            </select>
            <input
              v-if="step.body.kind === 'expression'"
              :value="step.body.expression"
              maxlength="1024"
              :aria-label="panels.lowcodeBackendWorkflowHttpBody"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 font-mono text-[9px] text-surface"
              @change="updateSourceText(step.body, ($event.target as HTMLInputElement).value)"
            />
            <select
              v-else
              :value="step.body.name"
              :aria-label="panels.lowcodeBackendWorkflowHttpBody"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
              @change="updateSourceText(step.body, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="name in environmentNames" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>
          <p v-if="step.headers?.length" class="text-[9px] text-muted">
            {{ panels.lowcodeBackendWorkflowComplexPreserved }}
          </p>
        </div>

        <div v-else-if="step.kind === 'branch'" class="mt-1 flex flex-col gap-1">
          <input
            v-model="step.condition"
            maxlength="1024"
            :aria-label="panels.lowcodeBackendWorkflowBranchCondition"
            :placeholder="panels.lowcodeBackendWorkflowBranchCondition"
            class="w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
          />
          <div class="grid grid-cols-2 gap-1 text-[9px] text-muted">
            <div class="rounded border border-border/70 p-1">
              {{ panels.lowcodeBackendWorkflowConsequent }} ·
              {{ step.consequent.map((entry) => entry.kind).join(', ') }}
            </div>
            <div class="rounded border border-border/70 p-1">
              {{ panels.lowcodeBackendWorkflowAlternate }} ·
              {{ step.alternate.map((entry) => entry.kind).join(', ') }}
            </div>
          </div>
          <p class="text-[9px] text-muted">{{ panels.lowcodeBackendWorkflowNestedPreserved }}</p>
        </div>

        <select
          v-else-if="step.kind === 'call'"
          v-model="step.workflowId"
          :aria-label="panels.lowcodeBackendWorkflowCallTarget"
          class="mt-1 w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
        >
          <option v-for="target in callTargets(workflow, step)" :key="target.id" :value="target.id">
            {{ target.name }}
          </option>
        </select>

        <div v-else-if="step.kind === 'respond'" class="mt-1 grid grid-cols-[72px_1fr] gap-1">
          <input
            :value="step.status"
            type="number"
            min="200"
            max="599"
            :aria-label="panels.lowcodeBackendResponseStatus"
            class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
            @change="updateResponseStatus(step, ($event.target as HTMLInputElement).value)"
          /><input
            :value="responseValue(step)"
            maxlength="1024"
            :aria-label="panels.lowcodeBackendResponseValue"
            :placeholder="panels.lowcodeBackendResponseValue"
            class="min-w-0 rounded border border-border bg-input px-1 py-1 font-mono text-[10px] text-surface"
            @change="updateResponse(step, ($event.target as HTMLInputElement).value)"
          />
        </div>

        <p v-else class="mt-1 text-[9px] text-muted">
          {{ panels.lowcodeBackendUnsupportedStep }}
        </p>

        <div
          v-if="step.kind === 'data.read' || step.kind === 'data.mutate'"
          data-test-id="lowcode-backend-workflow-filters"
          class="mt-1.5 border-t border-border/70 pt-1.5"
        >
          <div
            v-for="(filter, filterIndex) in step.filters ?? []"
            :key="`${step.id}:filter:${filterIndex}`"
            class="mt-1 grid grid-cols-[1fr_62px_78px_1fr_auto] gap-1"
          >
            <select
              v-model="filter.field"
              :aria-label="panels.lowcodeBackendWorkflowValueField"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
            >
              <option
                v-for="field in fieldsForEntity(step.entityId)"
                :key="field.id"
                :value="field.id"
              >
                {{ field.name }}
              </option>
            </select>
            <select
              v-model="filter.operator"
              aria-label="operator"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
            >
              <option v-for="operator in filterOperators" :key="operator" :value="operator">
                {{ operator }}
              </option>
            </select>
            <select
              :value="filter.value.kind"
              :aria-label="panels.lowcodeBackendWorkflowValueSource"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
              @change="
                setFilterValueKind(
                  filter,
                  ($event.target as HTMLSelectElement).value as BackendValueSource['kind']
                )
              "
            >
              <option value="expression">{{ panels.lowcodeBackendWorkflowExpression }}</option>
              <option v-if="environmentNames.length" value="environment">
                {{ panels.lowcodeBackendWorkflowEnvironment }}
              </option>
            </select>
            <input
              v-if="filter.value.kind === 'expression'"
              :value="sourceText(filter.value)"
              maxlength="1024"
              :aria-label="panels.lowcodeBackendWorkflowExpression"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 font-mono text-[9px] text-surface"
              @change="updateSourceText(filter.value, ($event.target as HTMLInputElement).value)"
            />
            <select
              v-else
              :value="filter.value.name"
              :aria-label="panels.lowcodeBackendWorkflowEnvironment"
              class="min-w-0 rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
              @change="updateSourceText(filter.value, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="name in environmentNames" :key="name" :value="name">{{ name }}</option>
            </select>
            <button
              type="button"
              :aria-label="panels.lowcodeBackendRemoveRule"
              :disabled="filterRemovalLocked(step)"
              class="px-1 text-muted hover:text-red-500 disabled:opacity-40"
              @click="removeFilter(step, filterIndex)"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            :disabled="
              fieldsForEntity(step.entityId).length === 0 ||
              (step.filters?.length ?? 0) >= BACKEND_LIMITS.maxFieldsPerEntity
            "
            class="mt-1 rounded px-1 text-[9px] text-muted hover:bg-hover disabled:opacity-40"
            @click="addFilter(step)"
          >
            + filter
          </button>
        </div>
      </div>

      <div class="mt-1.5 flex flex-wrap gap-1" data-test-id="lowcode-backend-workflow-step-builder">
        <button
          v-for="kind in stepKinds"
          :key="kind"
          type="button"
          :data-test-id="`lowcode-backend-add-step-${kind}`"
          :disabled="!canAddStep(workflow, kind)"
          class="rounded px-1 text-[9px] text-muted hover:bg-hover disabled:opacity-40"
          @click="addStep(workflow, kind)"
        >
          {{ stepLabel(kind) }}
        </button>
      </div>
    </div>
    <p
      v-if="operationError"
      role="alert"
      data-test-id="lowcode-backend-workflow-operation-error"
      class="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[9px] text-red-500"
    >
      {{ operationError }}
    </p>
  </div>
</template>
