<script setup lang="ts">
import { computed, ref } from 'vue'
import { BACKEND_LIMITS, type BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import { BackendDraftOperationError } from '../draft'
import {
  addBackendWorkflowEnvironmentReference,
  backendWorkflowEnvironmentReferences,
  removeBackendWorkflowEnvironmentReference,
  renameBackendWorkflowEnvironmentReference
} from '../workflow-environment'

const { application } = defineProps<{ application: BackendApplicationSpecV1 }>()
const { panels } = useI18n()
const name = ref('')
const operationError = ref('')
const references = computed(() => backendWorkflowEnvironmentReferences(application))

function run(operation: () => void): boolean {
  operationError.value = ''
  try {
    operation()
    return true
  } catch (cause) {
    operationError.value =
      cause instanceof BackendDraftOperationError
        ? cause.message
        : panels.value.lowcodeBackendOperationError
    return false
  }
}

function add(): void {
  if (run(() => addBackendWorkflowEnvironmentReference(application, name.value.trim())))
    name.value = ''
}

function rename(previousName: string, event: Event): void {
  const input = event.target as HTMLInputElement
  if (
    !run(() =>
      renameBackendWorkflowEnvironmentReference(application, previousName, input.value.trim())
    )
  ) {
    input.value = previousName
  }
}
</script>

<template>
  <div
    data-test-id="lowcode-backend-environment-references"
    class="rounded border border-border p-2"
  >
    <p class="text-[10px] text-muted">{{ panels.lowcodeBackendEnvironmentTitle }}</p>
    <p class="mb-1 text-[9px] text-muted">{{ panels.lowcodeBackendEnvironmentDescription }}</p>
    <div v-for="reference in references" :key="reference.name" class="mb-1 flex gap-1">
      <input
        :value="reference.name"
        maxlength="128"
        spellcheck="false"
        data-test-id="lowcode-backend-environment-name"
        :aria-label="panels.lowcodeBackendEnvironmentName"
        class="min-w-0 flex-1 rounded border border-border bg-input px-1 py-1 font-mono text-[10px] text-surface"
        @change="rename(reference.name, $event)"
      />
      <button
        type="button"
        :aria-label="panels.lowcodeBackendEnvironmentRemove"
        class="px-1 text-muted hover:text-red-500"
        @click="run(() => removeBackendWorkflowEnvironmentReference(application, reference.name))"
      >
        ×
      </button>
    </div>
    <form class="flex gap-1" @submit.prevent="add">
      <input
        v-model="name"
        maxlength="128"
        spellcheck="false"
        data-test-id="lowcode-backend-environment-new-name"
        :aria-label="panels.lowcodeBackendEnvironmentName"
        :placeholder="panels.lowcodeBackendEnvironmentName"
        class="min-w-0 flex-1 rounded border border-border bg-input px-1 py-1 font-mono text-[10px] text-surface"
      />
      <button
        type="submit"
        data-test-id="lowcode-backend-environment-add"
        :disabled="!name.trim() || application.secrets.length >= BACKEND_LIMITS.maxSecretRefs"
        class="rounded px-1 text-[9px] text-muted hover:bg-hover disabled:opacity-40"
      >
        {{ panels.lowcodeBackendEnvironmentAdd }}
      </button>
    </form>
    <p
      v-if="operationError"
      role="alert"
      data-test-id="lowcode-backend-environment-operation-error"
      class="mt-1 text-[9px] text-red-500"
    >
      {{ operationError }}
    </p>
  </div>
</template>
