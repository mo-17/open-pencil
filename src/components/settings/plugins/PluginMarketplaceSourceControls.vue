<script lang="ts">
export interface PluginMarketplaceSourceActiveView {
  readonly snapshotUrl: string
  readonly expectedMarketplaceId: string
  readonly channel: 'stable' | 'beta'
  readonly rootKeyId: string
  readonly rootKeySpkiSha256: string
}

export interface PluginMarketplaceSourceStateView {
  readonly ready: boolean
  readonly configured: boolean
  readonly origin: 'managed' | 'user' | 'none'
  readonly editable: boolean
  readonly active: PluginMarketplaceSourceActiveView | null
  readonly error: Error | null
}

export interface PluginMarketplaceSourceReviewView {
  readonly stageId: string
  readonly snapshotUrl: string
  readonly marketplaceId: string
  readonly channel: 'stable' | 'beta'
  readonly rootKeyId: string
  readonly rootFingerprint: string
  readonly isRootRotation: boolean
  readonly requiresStrictAdvance: boolean
  readonly snapshotVersion: string
  readonly snapshotSequence: number
  readonly snapshotDigest: string
  readonly expiresAt: string
  readonly auditSequence: number
  readonly auditHeadDigest: string
  readonly listingCount: number
  readonly catalogId: string
  readonly catalogVersion: string
  readonly catalogDigest: string
}

export interface PluginMarketplaceSourceInput {
  readonly schemaVersion: 1
  readonly url: string
  readonly marketplaceId: string
  readonly keyId: string
  readonly publicKeyPem: string
  readonly channel: 'stable' | 'beta'
}
</script>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { AlertDialogCancel, AlertDialogDescription, AlertDialogTitle } from 'reka-ui'
import { useI18n } from '@open-pencil/vue'

import AppBadge from '@/components/ui/AppBadge.vue'
import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'
import PluginMarketplaceSourceReviewDialog from './PluginMarketplaceSourceReviewDialog.vue'

const { state, review, busy, error, successMessage, installedPublisherCount } = defineProps<{
  state: PluginMarketplaceSourceStateView
  review: PluginMarketplaceSourceReviewView | null
  busy: 'verify' | 'activate' | 'remove' | null
  error: string | null
  successMessage: string | null
  installedPublisherCount: number
}>()

const emit = defineEmits<{
  verify: [input: PluginMarketplaceSourceInput]
  activate: [value: { stageId: string; confirmedFingerprint: string }]
  dismissReview: []
  remove: []
}>()

const { dialogs } = useI18n()
const editing = ref(false)
const removeOpen = ref(false)
const returnFocus = ref<HTMLElement | null>(null)
const sourceRoot = ref<HTMLElement | null>(null)
const urlInput = ref<HTMLInputElement | null>(null)
const verifyButton = ref<HTMLButtonElement | null>(null)
const form = reactive({
  url: '',
  marketplaceId: '',
  keyId: '',
  channel: 'stable' as 'stable' | 'beta',
  publicKeyPem: ''
})

const blockerVisible = computed(() => installedPublisherCount > 0 && state.editable)
const operationBusy = computed(() => busy !== null)
const showForm = computed(
  () =>
    state.ready && state.editable && state.origin !== 'managed' && (!state.active || editing.value)
)

watch(
  () => state.active,
  (active) => {
    if (!active || editing.value) return
    form.url = active.snapshotUrl
    form.marketplaceId = active.expectedMarketplaceId
    form.keyId = active.rootKeyId
    form.channel = active.channel
    form.publicKeyPem = ''
  },
  { immediate: true }
)

watch(
  () => successMessage,
  (message) => {
    if (!message) return
    editing.value = false
    form.publicKeyPem = ''
  }
)

watch(
  () => state.active,
  (active, previous) => {
    if (active || !previous || !removeOpen.value) return
    removeOpen.value = false
    void nextTick(() => urlInput.value?.focus())
  }
)

function rememberFocus(event: Event): void {
  returnFocus.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
}

function restoreFocus(): void {
  const target = returnFocus.value
  returnFocus.value = null
  void nextTick(() => {
    if (target?.isConnected) target.focus()
    else sourceRoot.value?.focus()
  })
}

function startReplacement(event: Event): void {
  rememberFocus(event)
  const active = state.active
  if (active) {
    form.url = active.snapshotUrl
    form.marketplaceId = active.expectedMarketplaceId
    form.keyId = active.rootKeyId
    form.channel = active.channel
  }
  form.publicKeyPem = ''
  editing.value = true
}

function cancelReplacement(): void {
  editing.value = false
  restoreFocus()
}

function verify(): void {
  returnFocus.value = verifyButton.value
  emit('verify', {
    schemaVersion: 1,
    url: form.url,
    marketplaceId: form.marketplaceId,
    keyId: form.keyId,
    publicKeyPem: form.publicKeyPem,
    channel: form.channel
  })
}

function dismissReview(): void {
  if (busy === 'activate') return
  emit('dismissReview')
  restoreFocus()
}

function activate(): void {
  if (!review || blockerVisible.value) return
  emit('activate', {
    stageId: review.stageId,
    confirmedFingerprint: review.rootFingerprint
  })
}

function requestRemoval(event: Event): void {
  rememberFocus(event)
  removeOpen.value = true
}

function updateRemoveOpen(open: boolean): void {
  removeOpen.value = open
  if (!open && busy !== 'remove') restoreFocus()
}

function remove(): void {
  if (blockerVisible.value) return
  emit('remove')
}
</script>

<template>
  <section
    ref="sourceRoot"
    class="rounded border border-border bg-panel-field p-3"
    data-test-id="plugin-marketplace-source-controls"
    :aria-busy="operationBusy"
    tabindex="-1"
  >
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <h4 class="text-[11px] font-medium text-surface">
          {{ dialogs.pluginMarketplaceSource }}
        </h4>
        <p class="mt-0.5 text-[9px] leading-4 text-muted">
          {{ dialogs.pluginMarketplaceSourceDescription }}
        </p>
      </div>
      <AppBadge v-if="state.origin === 'managed'" tone="warning">
        {{ dialogs.pluginMarketplaceSourceManaged }}
      </AppBadge>
      <AppBadge v-else-if="state.origin === 'user'" tone="success">
        {{ dialogs.pluginMarketplaceSourceUser }}
      </AppBadge>
      <AppBadge v-else tone="neutral">
        {{ dialogs.pluginMarketplaceSourceNone }}
      </AppBadge>
    </div>

    <p v-if="!state.ready" class="mt-3 text-[10px] text-muted" role="status">
      {{ dialogs.pluginMarketplaceSourceLoading }}
    </p>
    <p
      v-else-if="state.origin === 'managed' && !state.active"
      class="mt-3 text-[9px] leading-4 text-muted"
    >
      {{ dialogs.pluginMarketplaceSourceLocked }}
    </p>

    <div
      v-else-if="state.active"
      class="mt-3 rounded border border-border/70 bg-panel px-2.5 py-2 text-[9px]"
      data-test-id="plugin-marketplace-source-active"
    >
      <dl class="grid gap-x-3 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceUrl }}</dt>
        <dd class="break-all font-mono text-surface" data-test-id="plugin-marketplace-source-url">
          {{ state.active.snapshotUrl }}
        </dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceMarketplaceId }}</dt>
        <dd class="break-all font-mono text-surface">{{ state.active.expectedMarketplaceId }}</dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceChannel }}</dt>
        <dd class="text-surface">{{ state.active.channel }}</dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceRootKey }}</dt>
        <dd class="break-all font-mono text-surface">{{ state.active.rootKeyId }}</dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceRootFingerprint }}</dt>
        <dd
          class="break-all font-mono text-surface"
          data-test-id="plugin-marketplace-source-fingerprint"
        >
          {{ state.active.rootKeySpkiSha256 }}
        </dd>
      </dl>
      <p v-if="state.origin === 'managed'" class="mt-2 text-muted">
        {{ dialogs.pluginMarketplaceSourceLocked }}
      </p>
      <div v-else-if="!editing" class="mt-2 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          class="rounded border border-border px-2.5 py-1.5 text-[10px] text-surface hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="operationBusy || blockerVisible"
          data-test-id="plugin-marketplace-source-replace"
          @click="startReplacement"
        >
          {{ dialogs.pluginMarketplaceSourceReplace }}
        </button>
        <button
          type="button"
          class="rounded border border-danger/40 px-2.5 py-1.5 text-[10px] text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="operationBusy || blockerVisible"
          data-test-id="plugin-marketplace-source-remove"
          @click="requestRemoval"
        >
          {{ dialogs.pluginMarketplaceSourceRemove }}
        </button>
      </div>
    </div>

    <form
      v-if="showForm"
      class="mt-3 grid gap-2.5"
      data-test-id="plugin-marketplace-source-form"
      @submit.prevent="verify"
    >
      <label class="grid gap-1 text-[9px] text-muted">
        <span>{{ dialogs.pluginMarketplaceSourceUrl }}</span>
        <input
          ref="urlInput"
          v-model.trim="form.url"
          required
          type="url"
          inputmode="url"
          maxlength="2048"
          autocomplete="off"
          class="min-h-8 rounded border border-border bg-input px-2 text-[10px] text-surface outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
          :disabled="operationBusy"
          data-test-id="plugin-marketplace-source-url-input"
        />
        <span>{{ dialogs.pluginMarketplaceSourceUrlHint }}</span>
      </label>

      <div class="grid gap-2 sm:grid-cols-2">
        <label class="grid gap-1 text-[9px] text-muted">
          <span>{{ dialogs.pluginMarketplaceSourceMarketplaceId }}</span>
          <input
            v-model.trim="form.marketplaceId"
            required
            maxlength="128"
            autocomplete="off"
            spellcheck="false"
            class="min-h-8 rounded border border-border bg-input px-2 font-mono text-[10px] text-surface outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
            :disabled="operationBusy"
            data-test-id="plugin-marketplace-source-id-input"
          />
        </label>
        <label class="grid gap-1 text-[9px] text-muted">
          <span>{{ dialogs.pluginMarketplaceSourceRootKey }}</span>
          <input
            v-model.trim="form.keyId"
            required
            maxlength="128"
            autocomplete="off"
            spellcheck="false"
            class="min-h-8 rounded border border-border bg-input px-2 font-mono text-[10px] text-surface outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
            :disabled="operationBusy"
            data-test-id="plugin-marketplace-source-key-input"
          />
        </label>
      </div>

      <label class="grid gap-1 text-[9px] text-muted">
        <span>{{ dialogs.pluginMarketplaceSourceChannel }}</span>
        <select
          v-model="form.channel"
          class="min-h-8 rounded border border-border bg-input px-2 text-[10px] text-surface outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
          :disabled="operationBusy"
          data-test-id="plugin-marketplace-source-channel-input"
        >
          <option value="stable">{{ dialogs.pluginMarketplaceSourceChannelStable }}</option>
          <option value="beta">{{ dialogs.pluginMarketplaceSourceChannelBeta }}</option>
        </select>
      </label>

      <label class="grid gap-1 text-[9px] text-muted">
        <span>{{ dialogs.pluginMarketplaceSourceRootPem }}</span>
        <textarea
          v-model.trim="form.publicKeyPem"
          required
          rows="5"
          maxlength="8192"
          autocomplete="off"
          spellcheck="false"
          class="resize-y rounded border border-border bg-input px-2 py-1.5 font-mono text-[9px] leading-4 text-surface outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
          :disabled="operationBusy"
          data-test-id="plugin-marketplace-source-pem-input"
        />
        <span>{{ dialogs.pluginMarketplaceSourceRootPemHint }}</span>
      </label>

      <div class="flex flex-wrap justify-end gap-2">
        <button
          v-if="editing"
          type="button"
          class="rounded border border-border px-2.5 py-1.5 text-[10px] text-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          :disabled="operationBusy"
          data-test-id="plugin-marketplace-source-cancel-replace"
          @click="cancelReplacement"
        >
          {{ dialogs.cancel }}
        </button>
        <button
          ref="verifyButton"
          type="submit"
          class="rounded bg-accent px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="operationBusy || blockerVisible"
          data-test-id="plugin-marketplace-source-verify"
        >
          {{
            busy === 'verify'
              ? dialogs.pluginMarketplaceSourceVerifying
              : dialogs.pluginMarketplaceSourceVerify
          }}
        </button>
      </div>
    </form>

    <p
      v-if="blockerVisible"
      class="mt-2 rounded border border-warning/30 bg-warning/5 px-2 py-1.5 text-[9px] leading-4 text-warning"
      data-test-id="plugin-marketplace-source-blocker"
      role="status"
    >
      {{ dialogs.pluginMarketplaceSourceInstalledBlocker({ count: installedPublisherCount }) }}
    </p>
    <p
      v-if="(state.error || error) && !review && !removeOpen"
      class="mt-2 break-words rounded border border-error/30 bg-error/5 px-2 py-1.5 text-[9px] leading-4 text-error"
      data-test-id="plugin-marketplace-source-error"
      role="alert"
      aria-live="assertive"
    >
      {{ error ?? state.error?.message }}
    </p>
    <p
      v-if="successMessage"
      class="mt-2 text-[9px] text-success"
      data-test-id="plugin-marketplace-source-success"
      role="status"
      aria-live="polite"
    >
      {{ successMessage }}
    </p>
  </section>

  <PluginMarketplaceSourceReviewDialog
    :review="review"
    :busy="busy === 'activate'"
    :error="error"
    :installed-publisher-count="blockerVisible ? installedPublisherCount : 0"
    @close="dismissReview"
    @confirm="activate"
  />

  <AppAlertDialogRoot
    :open="removeOpen"
    data-test-id="plugin-marketplace-source-remove-dialog"
    @update:open="updateRemoveOpen"
  >
    <header class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ dialogs.pluginMarketplaceSourceRemoveTitle }}
      </AlertDialogTitle>
    </header>
    <AppDialogBody>
      <AlertDialogDescription class="text-xs leading-5 text-muted">
        {{ dialogs.pluginMarketplaceSourceRemoveDescription }}
      </AlertDialogDescription>
      <p
        v-if="blockerVisible"
        class="mt-2 rounded border border-warning/30 bg-warning/5 p-2 text-[9px] text-warning"
        role="status"
      >
        {{ dialogs.pluginMarketplaceSourceInstalledBlocker({ count: installedPublisherCount }) }}
      </p>
      <p
        v-if="error"
        class="mt-2 rounded border border-error/30 bg-error/5 p-2 text-[9px] text-error"
        role="alert"
        aria-live="assertive"
      >
        {{ error }}
      </p>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button
          type="button"
          class="rounded border border-border px-3 py-1.5 text-[11px] text-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          :disabled="busy === 'remove'"
          data-test-id="plugin-marketplace-source-remove-cancel"
        >
          {{ dialogs.cancel }}
        </button>
      </AlertDialogCancel>
      <button
        type="button"
        class="rounded bg-danger px-3 py-1.5 text-[11px] font-medium text-white hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy === 'remove' || blockerVisible"
        data-test-id="plugin-marketplace-source-remove-confirm"
        @click="remove"
      >
        {{
          busy === 'remove'
            ? dialogs.pluginMarketplaceSourceRemoving
            : dialogs.pluginMarketplaceSourceRemoveConfirm
        }}
      </button>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
