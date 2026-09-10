<script setup lang="ts">
import { BACKEND_WORKFLOW_EDITOR_MAX_NESTING } from '../draft'
import {
  useBackendWorkflowSteps,
  type BackendWorkflowStepsProps
} from '../use-backend-workflow-steps'
import {
  BACKEND_LIMITS,
  type BackendValueSource,
  type BackendWorkflowStepIR
} from '@open-pencil/lowcode/backend'

type DataMutateStep = Extract<BackendWorkflowStepIR, { kind: 'data.mutate' }>
const { application, workflow, steps, depth } = defineProps<BackendWorkflowStepsProps>()
const {
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
} = useBackendWorkflowSteps({
  get application() {
    return application
  },
  get workflow() {
    return workflow
  },
  get steps() {
    return steps
  },
  get depth() {
    return depth
  }
})
</script>

<template>
  <div data-test-id="lowcode-backend-workflow-steps" :data-depth="depth" class="min-w-0">
    <div
      v-for="step in steps"
      :key="step.id"
      :data-test-id="`lowcode-backend-workflow-step-${step.kind}`"
      class="mt-1.5 min-w-0"
      :class="
        depth === 0 ? 'rounded border border-border/70 p-1.5' : 'border-t border-border/70 py-1.5'
      "
    >
      <div class="flex items-center justify-between">
        <span class="font-mono text-[9px] text-muted">{{ step.kind }}</span
        ><button
          type="button"
          :aria-label="panels.lowcodeBackendRemoveStep"
          class="justify-self-end px-1 text-muted hover:text-red-500"
          @click="removeById(steps, step.id)"
        >
          ×
        </button>
      </div>

      <div v-if="step.kind === 'data.read'" class="mt-1 flex min-w-0 flex-col gap-1">
        <select
          :value="step.entityId"
          :aria-label="panels.lowcodeBackendEntity"
          class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
          @change="changeDataEntity(step, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="entity in entityOptions" :key="entity.id" :value="entity.id">
            {{ entity.name }}
          </option>
        </select>
        <div class="grid min-w-0 grid-cols-1 gap-1">
          <input
            v-model="step.resultName"
            maxlength="63"
            :aria-label="panels.lowcodeBackendWorkflowResultName"
            :placeholder="panels.lowcodeBackendWorkflowResultName"
            class="min-w-0 w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
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

      <div v-else-if="step.kind === 'data.mutate'" class="mt-1 flex min-w-0 flex-col gap-1">
        <div class="grid min-w-0 grid-cols-1 gap-1">
          <select
            :value="step.entityId"
            :aria-label="panels.lowcodeBackendEntity"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
            @change="changeDataEntity(step, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="entity in mutableEntityOptions" :key="entity.id" :value="entity.id">
              {{ entity.name }}
            </option>
          </select>
          <select
            :value="step.operation"
            :aria-label="panels.lowcodeBackendWorkflowMutationOperation"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
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
          class="min-w-0 w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
          @change="updateOptionalResultName(step, ($event.target as HTMLInputElement).value)"
        />
        <div
          v-for="(entry, index) in step.values ?? []"
          :key="`${step.id}:value:${index}`"
          class="grid min-w-0 grid-cols-1 gap-1"
        >
          <select
            :value="entry.field"
            :aria-label="panels.lowcodeBackendWorkflowValueField"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
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
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
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
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 font-mono text-[9px] text-surface"
            @change="updateSourceText(entry.value, ($event.target as HTMLInputElement).value)"
          />
          <select
            v-else
            :value="entry.value.name"
            :aria-label="panels.lowcodeBackendWorkflowEnvironment"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
            @change="updateSourceText(entry.value, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="name in environmentNames" :key="name" :value="name">{{ name }}</option>
          </select>
          <button
            type="button"
            :aria-label="panels.lowcodeBackendRemoveRule"
            :disabled="mutationValueRemovalLocked(step)"
            class="justify-self-end px-1 text-muted hover:text-red-500"
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

      <div v-else-if="step.kind === 'http.request'" class="mt-1 flex min-w-0 flex-col gap-1">
        <div class="grid min-w-0 grid-cols-1 gap-1">
          <select
            v-model="step.method"
            :aria-label="panels.lowcodeBackendWorkflowHttpMethod"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
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
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
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
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 font-mono text-[9px] text-surface"
            @change="updateSourceText(step.url, ($event.target as HTMLInputElement).value)"
          />
          <select
            v-else
            :value="step.url.name"
            :aria-label="panels.lowcodeBackendWorkflowHttpUrl"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
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
          class="min-w-0 w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
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
        <div v-if="step.body" class="grid min-w-0 grid-cols-1 gap-1">
          <select
            :value="step.body.kind"
            :aria-label="panels.lowcodeBackendWorkflowValueSource"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
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
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 font-mono text-[9px] text-surface"
            @change="updateSourceText(step.body, ($event.target as HTMLInputElement).value)"
          />
          <select
            v-else
            :value="step.body.name"
            :aria-label="panels.lowcodeBackendWorkflowHttpBody"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
            @change="updateSourceText(step.body, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="name in environmentNames" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>
        <p v-if="step.headers?.length" class="text-[9px] text-muted">
          {{ panels.lowcodeBackendWorkflowComplexPreserved }}
        </p>
      </div>

      <div v-else-if="step.kind === 'branch'" class="mt-1 flex min-w-0 flex-col gap-1">
        <input
          v-model="step.condition"
          maxlength="1024"
          :aria-label="panels.lowcodeBackendWorkflowBranchCondition"
          :placeholder="panels.lowcodeBackendWorkflowBranchCondition"
          class="min-w-0 w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface"
        />
        <div v-if="depth < BACKEND_WORKFLOW_EDITOR_MAX_NESTING" class="flex min-w-0 flex-col gap-2">
          <div
            v-for="branch in ['consequent', 'alternate'] as const"
            :key="branch"
            :data-test-id="`lowcode-backend-workflow-${branch}`"
            class="min-w-0 border-l border-border"
            :class="depth < 2 ? 'pl-1' : ''"
          >
            <p class="text-[9px] text-muted">
              {{
                branch === 'consequent'
                  ? panels.lowcodeBackendWorkflowConsequent
                  : panels.lowcodeBackendWorkflowAlternate
              }}
            </p>
            <BackendWorkflowStepsEditor
              :application="application"
              :workflow="workflow"
              :steps="step[branch]"
              :depth="depth + 1"
            />
          </div>
        </div>
        <p v-else class="text-[9px] text-muted">{{ panels.lowcodeBackendWorkflowDepthLimit }}</p>
      </div>

      <select
        v-else-if="step.kind === 'call'"
        v-model="step.workflowId"
        :aria-label="panels.lowcodeBackendWorkflowCallTarget"
        class="mt-1 min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
      >
        <option v-for="target in callTargets(workflow, step)" :key="target.id" :value="target.id">
          {{ target.name }}
        </option>
      </select>

      <div v-else-if="step.kind === 'respond'" class="mt-1 grid min-w-0 grid-cols-1 gap-1">
        <input
          :value="step.status"
          type="number"
          min="200"
          max="599"
          :aria-label="panels.lowcodeBackendResponseStatus"
          class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface"
          @change="updateResponseStatus(step, ($event.target as HTMLInputElement).value)"
        /><input
          :value="responseValue(step)"
          maxlength="1024"
          :aria-label="panels.lowcodeBackendResponseValue"
          :placeholder="panels.lowcodeBackendResponseValue"
          class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 font-mono text-[10px] text-surface"
          @change="updateResponse(step, ($event.target as HTMLInputElement).value)"
        />
      </div>

      <p v-else class="mt-1 text-[9px] text-muted">
        {{ panels.lowcodeBackendUnsupportedStep }}
      </p>

      <div
        v-if="step.kind === 'data.read' || step.kind === 'data.mutate'"
        data-test-id="lowcode-backend-workflow-filters"
        class="mt-1.5 min-w-0 border-t border-border/70 pt-1.5"
      >
        <div
          v-for="(filter, filterIndex) in step.filters ?? []"
          :key="`${step.id}:filter:${filterIndex}`"
          class="mt-1 grid min-w-0 grid-cols-1 gap-1"
        >
          <select
            v-model="filter.field"
            :aria-label="panels.lowcodeBackendWorkflowValueField"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
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
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
          >
            <option v-for="operator in filterOperators" :key="operator" :value="operator">
              {{ operator }}
            </option>
          </select>
          <select
            :value="filter.value.kind"
            :aria-label="panels.lowcodeBackendWorkflowValueSource"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
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
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 font-mono text-[9px] text-surface"
            @change="updateSourceText(filter.value, ($event.target as HTMLInputElement).value)"
          />
          <select
            v-else
            :value="filter.value.name"
            :aria-label="panels.lowcodeBackendWorkflowEnvironment"
            class="min-w-0 w-full rounded border border-border bg-input px-1 py-1 text-[9px] text-surface"
            @change="updateSourceText(filter.value, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="name in environmentNames" :key="name" :value="name">{{ name }}</option>
          </select>
          <button
            type="button"
            :aria-label="panels.lowcodeBackendRemoveRule"
            :disabled="filterRemovalLocked(step)"
            class="justify-self-end px-1 text-muted hover:text-red-500 disabled:opacity-40"
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

    <div
      class="mt-1.5 flex min-w-0 flex-wrap gap-1"
      data-test-id="lowcode-backend-workflow-step-builder"
    >
      <button
        v-for="kind in stepKinds"
        :key="kind"
        type="button"
        :data-test-id="`lowcode-backend-add-step-${kind}`"
        :disabled="!canAddStep(workflow, kind)"
        class="min-w-0 max-w-full rounded px-1 text-left text-[9px] break-words whitespace-normal text-muted hover:bg-hover disabled:opacity-40"
        @click="addStep(workflow, kind)"
      >
        {{ stepLabel(kind) }}
      </button>
    </div>
    <p
      v-if="operationError"
      role="alert"
      data-test-id="lowcode-backend-workflow-operation-error"
      class="mt-1 text-[9px] text-red-500"
    >
      {{ operationError }}
    </p>
  </div>
</template>
