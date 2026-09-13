<script setup lang="ts">
import { useI18n } from '@open-pencil/vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import BackendPreviewCopyValue from './backend-controls/BackendPreviewCopyValue.vue'
import { backendPreviewCopy } from './backend-controls/copy'
import {
  LOCAL_BACKEND_PREVIEW_CALLBACK,
  LOCAL_BACKEND_PREVIEW_ORIGIN,
  type LocalBackendPreviewState
} from './local-backend-connection'
import ManagedBackendPreviewControls from './managed-backend/ManagedBackendPreviewControls.vue'
import {
  DEFAULT_MANAGED_PREVIEW_CONFIG,
  type ManagedBackendPreviewController
} from './managed-backend/controller'
import type { ManagedBackendPresetDraft } from './managed-backend/presets'

const { state, browserURL, mode, managed, authentication, documentIdentity, applicationId } =
  defineProps<{
    state: LocalBackendPreviewState
    browserURL: string | null
    mode: 'external' | 'managed'
    managed: ManagedBackendPreviewController
    authentication: BackendHttpAPIOIDCAuthenticationIRV1 | null
    documentIdentity: object
    applicationId?: string
  }>()
const emit = defineEmits<{
  connect: [apiPort: number]
  disconnect: []
  open: []
  mode: [mode: 'external' | 'managed']
}>()
const { locale } = useI18n()
const text = computed(() => backendPreviewCopy(locale.value))
const apiPort = ref(3000)
const panelOpen = ref(false)
const initial = managed.config.value ?? DEFAULT_MANAGED_PREVIEW_CONFIG
const draft = ref<ManagedBackendPresetDraft>({
  audience: initial.audience || authentication?.resource || '',
  jwksURL: initial.jwksURL,
  caFile: initial.caFile
})
const status = computed(() => {
  if (mode === 'managed') {
    if (managed.busy.value) return text.value.busy
    if (managed.error.value) return text.value.failed
    if (managed.plan.value) return text.value.reviewPending
    if (managed.state.value?.phase === 'running') return text.value.running
    if (managed.canStart.value) return text.value.ready
    return managed.state.value ? text.value.stopped : text.value.unconfigured
  }
  if (state.kind === 'connected') return text.value.running
  if (state.kind === 'connecting') return text.value.connecting
  return text.value.stopped
})
const running = computed(() =>
  mode === 'managed' ? managed.state.value?.phase === 'running' : state.kind === 'connected'
)
watch(
  draft,
  () => {
    if (managed.enabled.value)
      void managed.invalidate('Server configuration changed. Prepare the backend again.')
  },
  { deep: true }
)
watch(
  [
    () => documentIdentity,
    () => applicationId,
    () => authentication?.issuer,
    () => authentication?.clientId
  ],
  () => {
    draft.value = { audience: authentication?.resource || '', jwksURL: '', caFile: '' }
  }
)
watch(
  () => authentication?.resource,
  (resource) => {
    if (!draft.value.audience && resource) draft.value.audience = resource
  }
)
</script>

<template>
  <DialogRoot v-model:open="panelOpen" :modal="false">
    <DialogTrigger as-child>
      <button
        type="button"
        data-test-id="lowcode-preview-local-backend-toggle"
        :aria-label="text.title"
        class="flex h-7 max-w-52 shrink-0 items-center gap-1.5 rounded border border-border px-2 text-xs text-surface hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
      >
        <icon-lucide-server class="size-3.5 shrink-0" />
        <span>NestJS</span>
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="running ? 'bg-emerald-500' : 'bg-muted'"
        />
        <span class="truncate text-muted">{{ status }}</span>
      </button>
    </DialogTrigger>
    <DialogPortal>
      <DialogContent
        class="fixed inset-y-0 right-0 z-[120] flex w-[min(30rem,100vw)] flex-col border-l border-border bg-panel text-surface shadow-xl outline-none"
        data-test-id="lowcode-preview-local-backend-settings"
        @interact-outside.prevent
      >
        <header
          class="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4"
        >
          <div class="min-w-0">
            <DialogTitle class="flex items-center gap-2 text-sm font-semibold"
              ><icon-lucide-server class="size-4" />{{ text.title }}</DialogTitle
            >
            <DialogDescription class="mt-1 text-xs leading-relaxed text-muted">{{
              text.description
            }}</DialogDescription>
          </div>
          <DialogClose as-child>
            <button
              type="button"
              :aria-label="text.close"
              class="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-accent"
            >
              <icon-lucide-x class="size-4" />
            </button>
          </DialogClose>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
          <div class="my-4 flex gap-1 rounded-lg border border-border bg-input p-1 text-xs">
            <button
              type="button"
              :aria-pressed="mode === 'managed'"
              data-test-id="backend-preview-managed-mode"
              class="min-h-9 flex-1 rounded-md px-3 text-surface hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-panel aria-pressed:shadow-sm"
              @click="emit('mode', 'managed')"
            >
              {{ text.managed }}
            </button>
            <button
              type="button"
              :aria-pressed="mode === 'external'"
              data-test-id="backend-preview-external-mode"
              class="min-h-9 flex-1 rounded-md px-3 text-surface hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-panel aria-pressed:shadow-sm"
              @click="emit('mode', 'external')"
            >
              {{ text.external }}
            </button>
          </div>
          <ManagedBackendPreviewControls
            v-if="mode === 'managed'"
            v-model:draft="draft"
            :controller="managed"
            :authentication="authentication"
            :browser-u-r-l="browserURL"
            @open="emit('open')"
          />
          <div v-else class="space-y-5">
            <section class="rounded-xl border border-border p-4">
              <h2 class="flex items-center gap-2 text-sm font-medium">
                <span
                  class="size-2 rounded-full"
                  :class="running ? 'bg-emerald-500' : 'bg-muted'"
                />{{ status }}
              </h2>
              <p class="mt-2 text-xs leading-relaxed text-muted">{{ text.externalDescription }}</p>
              <p
                v-if="state.message"
                role="status"
                class="mt-3 break-words text-xs leading-relaxed"
              >
                {{ state.message }}
              </p>
              <div class="mt-4 flex gap-2">
                <button
                  v-if="state.kind === 'connected'"
                  type="button"
                  :disabled="!browserURL"
                  data-test-id="lowcode-preview-local-open"
                  class="min-h-10 flex-1 rounded-lg bg-accent px-4 text-xs font-medium text-white focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                  @click="emit('open')"
                >
                  {{ text.open }}
                </button>
                <button
                  v-else
                  type="button"
                  :disabled="state.kind === 'connecting'"
                  data-test-id="lowcode-preview-local-connect"
                  class="min-h-10 flex-1 rounded-lg bg-accent px-4 text-xs font-medium text-white focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                  @click="emit('connect', apiPort)"
                >
                  {{ state.kind === 'connecting' ? text.connecting : text.connect }}
                </button>
                <button
                  v-if="state.kind === 'connecting' || state.kind === 'connected'"
                  type="button"
                  data-test-id="lowcode-preview-local-disconnect"
                  class="min-h-10 rounded-lg border border-border px-3 text-xs hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
                  @click="emit('disconnect')"
                >
                  {{ text.disconnect }}
                </button>
              </div>
              <BackendPreviewCopyValue
                v-if="browserURL"
                class="mt-4"
                :label="text.previewAddress"
                :value="browserURL"
              />
            </section>
            <details :open="state.kind !== 'connected'" class="border-t border-border pt-2">
              <summary
                class="cursor-pointer rounded py-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-accent"
              >
                {{ text.settings }}
              </summary>
              <label class="mt-3 flex items-center justify-between gap-3 text-xs">
                {{ text.apiPort }}
                <input
                  v-model.number="apiPort"
                  type="number"
                  min="1024"
                  max="65535"
                  :disabled="state.kind === 'connecting' || state.kind === 'connected'"
                  data-test-id="lowcode-preview-local-api-port"
                  class="h-9 w-24 rounded border border-border bg-input px-3 focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
              <p class="mt-3 text-xs leading-relaxed text-muted">{{ text.externalData }}</p>
              <div class="mt-4 space-y-3">
                <BackendPreviewCopyValue
                  :label="text.callback"
                  :value="`${LOCAL_BACKEND_PREVIEW_ORIGIN}${LOCAL_BACKEND_PREVIEW_CALLBACK}`"
                />
                <BackendPreviewCopyValue
                  :label="text.origin"
                  :value="LOCAL_BACKEND_PREVIEW_ORIGIN"
                />
                <p class="text-xs leading-relaxed text-muted">{{ text.browserHint }}</p>
              </div>
            </details>
            <p class="border-t border-border pt-4 text-xs leading-relaxed text-muted">
              {{ text.externalHint }}
            </p>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
