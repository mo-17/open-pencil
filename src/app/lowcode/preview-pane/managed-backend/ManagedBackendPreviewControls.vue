<script setup lang="ts">
import { useI18n } from '@open-pencil/vue'
import { computed, ref, watch } from 'vue'
import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import BackendPreviewCopyValue from '../backend-controls/BackendPreviewCopyValue.vue'
import BackendPreviewReview from '../backend-controls/BackendPreviewReview.vue'
import BackendPreviewSettings from '../backend-controls/BackendPreviewSettings.vue'
import { backendPreviewCopy } from '../backend-controls/copy'
import { DEFAULT_MANAGED_PREVIEW_CONFIG, type ManagedBackendPreviewController } from './controller'
import type { ManagedBackendPresetDraft } from './presets'
import {
  LOCAL_KEYCLOAK_JWKS,
  hasPublicDocumentAuthentication,
  isManagedPresetAudience,
  isManagedPresetCAPath,
  isManagedPresetJWKS
} from './presets/identity'

const { controller, authentication, browserURL } = defineProps<{
  controller: ManagedBackendPreviewController
  authentication: BackendHttpAPIOIDCAuthenticationIRV1 | null
  browserURL: string | null
}>()
const draft = defineModel<ManagedBackendPresetDraft>('draft', { required: true })
const emit = defineEmits<{ open: [] }>()
const { locale } = useI18n()
const text = computed(() => backendPreviewCopy(locale.value))
const { state, busy, message, error, logs, plan, canStart } = controller
const configurationReady = computed(
  () =>
    controller.enabled.value &&
    !error.value &&
    state.value !== null &&
    draft.value.audience.trim() === controller.config.value?.audience &&
    draft.value.jwksURL.trim() === controller.config.value.jwksURL &&
    draft.value.caFile.trim() === controller.config.value.caFile
)
const settingsOpen = ref(!configurationReady.value)
const logsOpen = ref(Boolean(error.value))
const reviewOpen = ref(false)
const running = computed(() => state.value?.phase === 'running')
const canPrepare = computed(
  () =>
    !busy.value &&
    hasPublicDocumentAuthentication(authentication) &&
    isManagedPresetAudience(draft.value.audience.trim()) &&
    isManagedPresetJWKS(draft.value.jwksURL.trim()) &&
    (!draft.value.caFile.trim() || isManagedPresetCAPath(draft.value.caFile.trim())) &&
    (draft.value.jwksURL.trim() !== LOCAL_KEYCLOAK_JWKS || Boolean(draft.value.caFile.trim()))
)
const status = computed(() => {
  if (busy.value) return text.value.busy
  if (error.value) return text.value.failed
  if (plan.value?.kind === 'blocked') return text.value.blocked
  if (plan.value) return text.value.reviewPending
  if (running.value) return text.value.running
  if (canStart.value) return text.value.ready
  return state.value ? text.value.stopped : text.value.unconfigured
})
const hint = computed(() => {
  if (running.value) return text.value.runningHint
  if (canStart.value) return text.value.readyHint
  return state.value ? text.value.stoppedHint : text.value.prepareHint
})
watch(error, (value) => {
  if (value) logsOpen.value = true
})
watch(configurationReady, (ready) => {
  if (!ready) settingsOpen.value = true
})
watch(
  draft,
  () => {
    settingsOpen.value = true
  },
  { deep: true }
)
watch(
  () => plan.value?.planId,
  () => {
    reviewOpen.value = false
  }
)

async function prepare() {
  await controller.prepare({
    ...DEFAULT_MANAGED_PREVIEW_CONFIG,
    audience: draft.value.audience.trim(),
    jwksURL: draft.value.jwksURL.trim(),
    caFile: draft.value.caFile.trim()
  })
  if (!error.value && state.value) settingsOpen.value = false
}
</script>

<template>
  <div class="space-y-5" data-test-id="managed-backend-controls">
    <section class="rounded-xl border border-border p-4">
      <div class="flex items-center gap-2 text-sm font-medium text-surface" role="status">
        <icon-lucide-loader-circle v-if="busy" class="size-4 motion-safe:animate-spin" />
        <icon-lucide-circle-alert v-else-if="error || plan" class="size-4 text-amber-500" />
        <span v-else class="size-2 rounded-full" :class="running ? 'bg-emerald-500' : 'bg-muted'" />
        {{ status }}
      </div>
      <p class="mt-2 text-xs leading-relaxed text-muted">{{ text.managedDescription }}</p>
      <p v-if="!plan && !busy && !error" class="mt-2 text-xs leading-relaxed text-muted">
        {{ hint }}
      </p>
      <p
        v-if="busy || error"
        class="mt-3 break-words text-xs leading-relaxed text-surface"
        :role="error ? 'alert' : 'status'"
        data-test-id="managed-backend-message"
      >
        {{ message }}
      </p>
      <div v-else class="sr-only" role="status" data-test-id="managed-backend-message">
        {{ message }}
      </div>
      <button
        v-if="error && logs.length"
        type="button"
        class="mt-2 rounded text-xs text-accent underline focus-visible:ring-2 focus-visible:ring-accent"
        @click="logsOpen = true"
      >
        {{ text.viewLogs }}
      </button>
      <div v-if="!plan" class="mt-4 flex items-center gap-2">
        <button
          v-if="busy"
          type="button"
          disabled
          class="min-h-10 flex-1 rounded-lg bg-accent px-4 text-xs font-medium text-white opacity-50"
        >
          {{ text.busy }}
        </button>
        <button
          v-else-if="running"
          type="button"
          :disabled="!browserURL"
          data-test-id="managed-backend-open"
          class="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-xs font-medium text-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-40"
          @click="emit('open')"
        >
          <icon-lucide-external-link class="size-4" />{{ text.open }}
        </button>
        <button
          v-else-if="canStart"
          type="button"
          data-test-id="managed-backend-start"
          class="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-xs font-medium text-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          @click="controller.start"
        >
          <icon-lucide-play class="size-4" />{{ text.start }}
        </button>
        <button
          v-else
          type="button"
          :disabled="!canPrepare"
          data-test-id="managed-backend-prepare"
          class="min-h-10 flex-1 rounded-lg bg-accent px-4 text-xs font-medium text-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-40"
          @click="prepare"
        >
          {{ text.prepare }}
        </button>
        <button
          v-if="running || busy"
          type="button"
          data-test-id="managed-backend-stop"
          class="min-h-10 rounded-lg border border-border px-4 text-xs text-surface hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
          @click="controller.stop"
        >
          {{ text.stop }}
        </button>
      </div>
      <BackendPreviewCopyValue
        v-if="running && browserURL"
        class="mt-4"
        :label="text.previewAddress"
        :value="browserURL"
      />
    </section>
    <section
      v-if="plan"
      class="rounded-xl border border-amber-500/50 bg-amber-500/5 p-4"
      data-test-id="managed-backend-plan"
    >
      <h3 class="text-sm font-medium text-surface">
        {{ plan.kind === 'initial' ? text.initialTitle : text.updateTitle }}
      </h3>
      <ul class="mt-2 list-inside list-disc space-y-1 text-xs leading-relaxed text-muted">
        <li v-for="item in plan.summary" :key="item">{{ item }}</li>
      </ul>
      <p v-if="plan.kind === 'blocked'" class="mt-3 text-xs leading-relaxed text-amber-500">
        {{ text.blockedHint }}
      </p>
      <div class="mt-4 flex gap-2">
        <button
          type="button"
          :disabled="busy"
          data-test-id="managed-backend-review-open"
          class="min-h-10 flex-1 rounded-lg bg-accent px-4 text-xs font-medium text-white focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          @click="reviewOpen = true"
        >
          {{ text.review }}
        </button>
        <button
          type="button"
          data-test-id="managed-backend-stop"
          class="min-h-10 rounded-lg border border-border px-4 text-xs text-surface hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
          @click="controller.stop"
        >
          {{ text.stop }}
        </button>
      </div>
      <BackendPreviewReview
        v-model:open="reviewOpen"
        :plan="plan"
        :busy="busy"
        @confirm="controller.confirm"
      />
    </section>
    <details
      :open="settingsOpen"
      class="border-t border-border pt-2"
      @toggle="settingsOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary
        class="cursor-pointer rounded py-3 text-xs font-medium text-surface focus-visible:ring-2 focus-visible:ring-accent"
      >
        {{ text.settings }}
        <span class="float-right font-normal text-muted">{{
          configurationReady ? text.configured : text.required
        }}</span>
      </summary>
      <BackendPreviewSettings v-model:draft="draft" :authentication="authentication" :busy="busy" />
    </details>
    <details class="border-t border-border pt-2">
      <summary
        class="cursor-pointer rounded py-3 text-xs font-medium text-surface focus-visible:ring-2 focus-visible:ring-accent"
      >
        {{ text.serviceDetails }}
      </summary>
      <dl class="space-y-3 pt-2 text-xs">
        <div class="flex flex-wrap justify-between gap-2">
          <dt class="text-muted">{{ text.api }}</dt>
          <dd class="select-text text-surface">
            127.0.0.1:{{ DEFAULT_MANAGED_PREVIEW_CONFIG.apiPort }}
          </dd>
        </div>
        <div class="flex flex-wrap justify-between gap-2">
          <dt class="text-muted">{{ text.database }}</dt>
          <dd class="select-text text-surface">
            127.0.0.1:{{ DEFAULT_MANAGED_PREVIEW_CONFIG.dbPort }}
          </dd>
        </div>
      </dl>
    </details>
    <details
      :open="logsOpen"
      class="border-t border-border pt-2"
      @toggle="logsOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary
        class="cursor-pointer rounded py-3 text-xs font-medium text-surface focus-visible:ring-2 focus-visible:ring-accent"
      >
        {{ text.log }}<span v-if="logs.length" class="ml-2 text-muted">{{ logs.length }}</span>
      </summary>
      <ol
        v-if="logs.length"
        class="mt-2 max-h-56 select-text space-y-1 overflow-auto break-words rounded-lg border border-border bg-input p-3 font-mono text-xs leading-relaxed text-surface"
        data-test-id="managed-backend-logs"
      >
        <li v-for="(line, index) in logs" :key="index">{{ line }}</li>
      </ol>
      <p v-else class="py-2 text-xs text-muted">{{ text.noLogs }}</p>
    </details>
  </div>
</template>
