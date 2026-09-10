<script setup lang="ts">
import { ref } from 'vue'
import {
  BACKEND_LIMITS,
  type BackendApplicationSpecV1,
  type BackendWorkflowDefinitionIR
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'
import { BackendDraftOperationError, addBackendWorkflow, removeBackendWorkflow } from '../draft'
import BackendWorkflowStepsEditor from './BackendWorkflowStepsEditor.vue'
import BackendWorkflowEnvironmentEditor from './BackendWorkflowEnvironmentEditor.vue'

const { application } = defineProps<{ application: BackendApplicationSpecV1 }>()
const { panels } = useI18n()
const operationError = ref('')

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

function removeWorkflow(workflowId: string): void {
  run(() => removeBackendWorkflow(application, workflowId))
}
</script>

<template>
  <div class="mt-2 flex flex-col gap-2" data-test-id="lowcode-backend-workflows">
    <BackendWorkflowEnvironmentEditor :application="application" />
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
      <BackendWorkflowStepsEditor
        :application="application"
        :workflow="workflow"
        :steps="workflow.steps"
        :depth="0"
      />
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
