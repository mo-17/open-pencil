<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { appPluginStore } from '@/app/plugins/app'
import {
  appConnectorAuthorization,
  executeInstalledAppConnector
} from '@/app/plugins/connectors/app'
import {
  connectorExecutionDataText,
  connectorExecutionErrorCode,
  connectorMutationConfirmationMatches,
  connectorMutationReviewMatches,
  connectorOperationParameterSkeleton,
  connectorParameterFingerprint,
  createConnectorMutationConfirmationGate,
  createConnectorMutationReview,
  parseConnectorOperationParameters,
  requiredConnectorOperationParameterNames,
  type ConnectorMutationReview
} from '@/app/plugins/connectors/operation/runner-model'
import type {
  PluginConnectorControl,
  PluginConnectorControlsCopy,
  PluginConnectorOperationControl
} from '@/app/plugins/connectors/settings-controls-model'
import type { InstalledPluginConnector } from '@/app/plugins/types'

const {
  connector: connectorControl,
  operation,
  copy
} = defineProps<{
  connector: PluginConnectorControl
  operation: PluginConnectorOperationControl
  copy: PluginConnectorControlsCopy
}>()

const parametersInput = ref<HTMLTextAreaElement | null>(null)
const reviewing = ref(false)
const confirming = ref(false)
const running = ref(false)
const pendingReview = ref<ConnectorMutationReview | null>(null)
const resultText = ref<string | null>(null)
const errorText = ref<string | null>(null)
let activeController: AbortController | null = null
let executionRevision = 0
let disposed = false
const mutationConfirmationGate = createConnectorMutationConfirmationGate()

const inputId = computed(
  () => `connector-parameters-${connectorControl.connectorId}-${operation.operationId}`
)
const requiredFields = computed(() => requiredConnectorOperationParameterNames(operation.contract))
const operationIdentity = computed(
  () =>
    `${connectorControl.contract.pluginId}\0${connectorControl.connectorId}\0${connectorControl.packageDigest}\0${connectorControl.adapterId}\0${operation.operationId}`
)

function resetOutput(): void {
  pendingReview.value = null
  resultText.value = null
  errorText.value = null
}

function resetInput(): void {
  if (parametersInput.value) {
    parametersInput.value.value = connectorOperationParameterSkeleton(operation.contract)
  }
}

function fillOperationExample(): void {
  if (!parametersInput.value || !operation.help.exampleJson || confirming.value || running.value) {
    return
  }
  parametersInput.value.value = operation.help.exampleJson
  resetOutput()
  parametersInput.value.focus()
}

function operationFieldType(field: (typeof operation.help.fields)[number]): string {
  return field.itemType ? `${field.type}<${field.itemType}>` : field.type
}

function abortExecution(): void {
  activeController?.abort()
}

function operationError(cause: unknown): string {
  const code = connectorExecutionErrorCode(cause)
  if (code === 'outcome-unknown') return copy.executionOutcomeUnknown
  if (code === 'aborted') return copy.executionCancelled
  return code ? `${copy.executionFailed} (${code})` : copy.executionFailed
}

function resolveCurrent(): {
  connector: InstalledPluginConnector
  operation: InstalledPluginConnector['contribution']['operations'][number]
} | null {
  if (disposed) return null
  const currentConnector = appPluginStore.connector(
    connectorControl.contract.pluginId,
    connectorControl.connectorId
  )
  if (
    !currentConnector ||
    !appConnectorAuthorization.isAuthorized(
      currentConnector.contribution,
      currentConnector.plugin.package.digest
    )
  ) {
    return null
  }
  const currentOperation = currentConnector.contribution.operations.find(
    (candidate) => candidate.operationId === operation.operationId
  )
  return currentOperation?.request
    ? { connector: currentConnector, operation: currentOperation }
    : null
}

function readCurrentParameters(
  operation: InstalledPluginConnector['contribution']['operations'][number]
) {
  const source = parametersInput.value?.value
  if (source === undefined) throw new TypeError('Connector parameter input is unavailable')
  return { source, parsed: parseConnectorOperationParameters(source, operation) }
}

async function executeCurrent(
  connector: InstalledPluginConnector,
  operation: InstalledPluginConnector['contribution']['operations'][number],
  parameters: ReturnType<typeof parseConnectorOperationParameters>['parameters'],
  review?: ConnectorMutationReview
): Promise<void> {
  if (activeController) {
    activeController.abort()
    errorText.value = copy.executionCancelled
    return
  }
  const revision = ++executionRevision
  const controller = new AbortController()
  activeController = controller
  running.value = true
  resultText.value = null
  errorText.value = null
  try {
    const result = await executeInstalledAppConnector(
      connector,
      operation.operationId,
      parameters,
      {
        signal: controller.signal,
        ...(review
          ? {
              mutationAttemptId: review.mutationAttemptId,
              confirmMutation: (confirmation) =>
                connectorMutationConfirmationMatches(review, confirmation)
            }
          : {})
      }
    )
    if (revision === executionRevision && activeController === controller) {
      resultText.value = connectorExecutionDataText(result)
      pendingReview.value = null
    }
  } catch (cause) {
    if (revision === executionRevision && activeController === controller) {
      errorText.value = operationError(cause)
      if (connectorExecutionErrorCode(cause) === 'outcome-unknown') {
        pendingReview.value = review ?? null
      }
    }
  } finally {
    if (revision === executionRevision && activeController === controller) {
      activeController = null
      running.value = false
    }
  }
}

async function runQuery(): Promise<void> {
  if (reviewing.value || confirming.value || running.value) return
  resetOutput()
  const current = resolveCurrent()
  if (!current || current.operation.kind !== 'query') {
    errorText.value = copy.connectorChanged
    return
  }
  try {
    const { parsed } = readCurrentParameters(current.operation)
    await executeCurrent(current.connector, current.operation, parsed.parameters)
  } catch {
    errorText.value = copy.invalidParameters
  }
}

async function reviewMutation(): Promise<void> {
  if (reviewing.value || confirming.value || running.value) return
  resetOutput()
  const current = resolveCurrent()
  if (!current || current.operation.kind !== 'mutation') {
    errorText.value = copy.connectorChanged
    return
  }
  reviewing.value = true
  try {
    const { source, parsed } = readCurrentParameters(current.operation)
    const fingerprint = await connectorParameterFingerprint(parsed.parameters)
    if (disposed || parametersInput.value?.value !== source) {
      errorText.value = copy.connectorChanged
      return
    }
    pendingReview.value = createConnectorMutationReview(
      current.connector,
      current.operation,
      parsed.byteLength,
      fingerprint
    )
  } catch {
    errorText.value = copy.invalidParameters
  } finally {
    reviewing.value = false
  }
}

async function confirmMutation(): Promise<void> {
  const review = pendingReview.value
  if (!review || !mutationConfirmationGate.tryEnter()) return
  pendingReview.value = null
  confirming.value = true
  try {
    const current = resolveCurrent()
    if (!current || current.operation.kind !== 'mutation') {
      resetOutput()
      errorText.value = copy.connectorChanged
      return
    }
    const { parsed } = readCurrentParameters(current.operation)
    const fingerprint = await connectorParameterFingerprint(parsed.parameters)
    if (disposed) return
    if (
      !connectorMutationReviewMatches(
        review,
        current.connector,
        current.operation,
        parsed.byteLength,
        fingerprint
      )
    ) {
      resetOutput()
      errorText.value = copy.connectorChanged
      return
    }
    await executeCurrent(current.connector, current.operation, parsed.parameters, review)
  } catch {
    resetOutput()
    errorText.value = copy.invalidParameters
  } finally {
    confirming.value = false
    mutationConfirmationGate.leave()
  }
}

function parametersChanged(): void {
  resetOutput()
}

function cancelReview(): void {
  pendingReview.value = null
}

onMounted(resetInput)
watch(operationIdentity, () => {
  abortExecution()
  resetOutput()
  resetInput()
})
onBeforeUnmount(() => {
  disposed = true
  executionRevision += 1
  abortExecution()
})
</script>

<template>
  <div class="mt-1.5 rounded border border-border/60 bg-panel p-1.5">
    <label class="font-medium text-surface" :for="inputId">{{ copy.parametersJson }}</label>
    <p class="mt-0.5 font-mono text-[8px]">
      {{ copy.requiredFields }}:
      {{ requiredFields.length ? requiredFields.join(', ') : copy.noRequiredFields }} ·
      {{ copy.maximumBytes }}: {{ operation.contract.parameters.maxBytes }}
    </p>
    <details class="mt-1 rounded border border-border/60 bg-input/40 p-1">
      <summary class="cursor-pointer font-medium text-surface">{{ copy.parameterGuide }}</summary>
      <dl class="mt-1 space-y-1">
        <div
          v-for="field in operation.help.fields"
          :key="field.path"
          class="rounded border border-border/50 bg-panel p-1"
        >
          <div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <code class="break-all text-[8px] text-surface">{{ field.path }}</code>
            <span class="font-mono text-[8px]">{{ operationFieldType(field) }}</span>
            <span v-if="field.required" class="text-[8px] text-[var(--color-warning-text)]">
              {{ copy.required }}
            </span>
          </div>
          <dt class="mt-0.5 font-medium text-surface">{{ field.label }}</dt>
          <dd>{{ field.description }}</dd>
          <dd v-if="field.constraintTokens.length" class="mt-0.5 font-mono text-[8px]">
            {{ copy.constraints }}: {{ field.constraintTokens.join(' · ') }}
          </dd>
        </div>
      </dl>
      <p v-if="operation.help.truncated" class="mt-1 text-[8px]">
        {{ copy.guideTruncated }}
      </p>
      <div v-if="operation.help.exampleJson" class="mt-1 rounded border border-border/60 p-1">
        <p class="font-medium text-surface">{{ copy.example }}</p>
        <pre
          class="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-input p-1 font-mono text-[8px] text-surface"
          >{{ operation.help.exampleJson }}</pre
        >
        <button
          type="button"
          class="mt-1 rounded border border-border px-2 py-1 text-surface disabled:opacity-50"
          :disabled="confirming || running"
          @click="fillOperationExample"
        >
          {{ copy.fillExample }}
        </button>
      </div>
    </details>
    <textarea
      :id="inputId"
      ref="parametersInput"
      rows="6"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :maxlength="operation.contract.parameters.maxBytes"
      :disabled="confirming || running"
      class="mt-1 w-full resize-y rounded border border-border bg-input px-1.5 py-1 font-mono text-[9px] text-surface outline-none focus:border-accent disabled:opacity-60"
      @input="parametersChanged"
    />

    <div class="mt-1 flex flex-wrap gap-1">
      <button
        v-if="operation.kind === 'query'"
        type="button"
        class="rounded bg-accent px-2 py-1 font-medium text-white disabled:opacity-50"
        :disabled="reviewing || confirming || running"
        @click="runQuery"
      >
        {{ running ? copy.running : copy.runQuery }}
      </button>
      <button
        v-else-if="operation.kind === 'mutation' && !pendingReview"
        type="button"
        class="rounded bg-accent px-2 py-1 font-medium text-white disabled:opacity-50"
        :disabled="reviewing || confirming || running"
        @click="reviewMutation"
      >
        {{ confirming || running ? copy.running : copy.reviewMutation }}
      </button>
      <button
        v-if="running"
        type="button"
        class="rounded border border-border px-2 py-1 text-surface"
        @click="abortExecution"
      >
        {{ operation.kind === 'mutation' ? copy.stopWaiting : copy.cancel }}
      </button>
    </div>

    <div
      v-if="pendingReview"
      class="mt-1.5 rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-1.5 text-[var(--color-warning-text)]"
      role="alert"
    >
      <p class="font-medium">{{ copy.reviewTitle }}</p>
      <p>{{ copy.reviewWarning }}</p>
      <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-2 font-mono text-[8px]">
        <dt>{{ copy.packageDigest }}</dt>
        <dd class="break-all">{{ pendingReview.packageDigest }}</dd>
        <dt>adapterId</dt>
        <dd class="break-all">{{ pendingReview.adapterId }}</dd>
        <dt>
          {{
            pendingReview.authorityKind === 'origin-template' ? copy.originTemplate : copy.origin
          }}
        </dt>
        <dd class="break-all">{{ pendingReview.authority }}</dd>
        <dt>{{ copy.method }}</dt>
        <dd>{{ pendingReview.method }}</dd>
        <dt>{{ copy.path }}</dt>
        <dd class="break-all">{{ pendingReview.pathTemplate }}</dd>
        <dt>{{ copy.parameterBytes }}</dt>
        <dd>{{ pendingReview.parameterBytes }}</dd>
        <dt>{{ copy.parameterFingerprint }}</dt>
        <dd class="break-all">{{ pendingReview.parameterFingerprint }}</dd>
        <dt>{{ copy.mutationAttemptId }}</dt>
        <dd class="break-all">{{ pendingReview.mutationAttemptId }}</dd>
      </dl>
      <div class="mt-1 flex gap-1">
        <button
          type="button"
          class="rounded bg-accent px-2 py-1 font-medium text-white disabled:opacity-50"
          :disabled="confirming || running"
          @click="confirmMutation"
        >
          {{ running ? copy.running : copy.confirmMutation }}
        </button>
        <button
          type="button"
          class="rounded border border-current px-2 py-1 disabled:opacity-50"
          :disabled="confirming || running"
          @click="cancelReview"
        >
          {{ copy.cancelReview }}
        </button>
      </div>
    </div>

    <p v-if="errorText" class="mt-1 text-error" role="alert">{{ errorText }}</p>
    <div v-if="resultText !== null" class="mt-1">
      <p class="font-medium text-surface">{{ copy.result }}</p>
      <pre
        class="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-input p-1 font-mono text-[8px] text-surface"
        >{{ resultText }}</pre
      >
    </div>
  </div>
</template>
