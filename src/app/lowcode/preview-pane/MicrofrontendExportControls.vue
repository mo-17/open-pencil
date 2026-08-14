<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot
} from '@/components/ui/dialog'
import Tip from '@/components/ui/Tip.vue'

import {
  defaultMicrofrontendAppId,
  microfrontendAppIdError,
  microfrontendVersionError,
  type MicrofrontendExportTarget,
  type MicrofrontendExportUIKit
} from './microfrontend-export/command'
import { useMicrofrontendExport } from './microfrontend-export/use'

const {
  target,
  uiKit,
  i18nEnabled = false,
  iconOnly = false,
  showTrigger = true
} = defineProps<{
  target: MicrofrontendExportTarget
  uiKit: MicrofrontendExportUIKit
  i18nEnabled?: boolean
  iconOnly?: boolean
  showTrigger?: boolean
}>()

const store = useEditorStore()
const dialogOpen = ref(false)
const appId = ref('')
const version = ref('0.0.0')
const appIdInput = useTemplateRef<HTMLInputElement>('app-id-input')
const { status, exportAvailable, unavailableReason, exportProject, cancel, reset } =
  useMicrofrontendExport()

const appIdError = computed(() => microfrontendAppIdError(appId.value))
const versionError = computed(() => microfrontendVersionError(version.value))
const busy = computed(
  () =>
    status.value.kind === 'choosing' ||
    status.value.kind === 'snapshotting' ||
    status.value.kind === 'building' ||
    status.value.kind === 'cancelling'
)
const canExport = computed(
  () => exportAvailable && !i18nEnabled && !busy.value && !appIdError.value && !versionError.value
)
const targetLabel = computed(() => (target === 'react' ? 'React' : 'Vue 3'))
const uiKitLabel = computed(() => {
  if (target === 'vue') return 'Tailwind'
  return uiKit === 'shadcn' ? 'shadcn/ui' : 'Tailwind'
})
const actionLabel = computed(() => {
  if (status.value.kind === 'done') return 'Export again'
  if (status.value.kind === 'choosing') return 'Choosing folder…'
  if (status.value.kind === 'snapshotting') return 'Preparing snapshot…'
  if (status.value.kind === 'building') return 'Building…'
  if (status.value.kind === 'cancelling') return 'Cancelling…'
  return 'Choose folder & export'
})

function openExport(): void {
  reset()
  appId.value = defaultMicrofrontendAppId(store.state.documentName || 'OpenPencil App')
  version.value = '0.0.0'
  dialogOpen.value = true
  void nextTick(() => appIdInput.value?.focus())
}

function requestClose(): void {
  if (busy.value) return
  dialogOpen.value = false
}

function preventBusyDismiss(event: Event): void {
  if (busy.value) event.preventDefault()
}

async function submit(): Promise<void> {
  if (!canExport.value) return
  await exportProject({
    target,
    uiKit,
    appId: appId.value.trim(),
    version: version.value.trim()
  })
}

defineExpose({ openExport })
</script>

<template>
  <Tip v-if="showTrigger" label="Build a compose-ready microfrontend">
    <button
      type="button"
      data-test-id="lowcode-microfrontend-export-toggle"
      aria-haspopup="dialog"
      class="flex h-7 shrink-0 items-center justify-center gap-1 rounded px-2 text-xs text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
      :class="iconOnly ? 'w-7 px-0' : undefined"
      @click="openExport"
    >
      <icon-lucide-package-open class="size-3.5" />
      <span v-if="!iconOnly">Export MFE</span>
    </button>
  </Tip>

  <AppDialogRoot
    v-model:open="dialogOpen"
    size="sm"
    data-test-id="lowcode-microfrontend-export-dialog"
    :aria-busy="busy"
    @escape-key-down="preventBusyDismiss"
    @pointer-down-outside="preventBusyDismiss"
    @interact-outside="preventBusyDismiss"
  >
    <AppDialogHeader
      heading="Export microfrontend"
      description="Build the current canvas into a verified ESM package that OpenPencil compositions can mount."
      close-label="Close microfrontend export"
      :show-close="!busy"
    />
    <AppDialogBody>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="grid grid-cols-2 gap-3 rounded border border-border bg-panel p-3 text-xs">
          <div>
            <div class="text-muted">Target</div>
            <div class="mt-1 font-medium text-surface">{{ targetLabel }}</div>
          </div>
          <div>
            <div class="text-muted">UI components</div>
            <div class="mt-1 font-medium text-surface">{{ uiKitLabel }}</div>
          </div>
        </div>

        <label class="flex flex-col gap-1 text-xs text-muted">
          App ID
          <input
            ref="app-id-input"
            v-model="appId"
            data-test-id="lowcode-microfrontend-app-id"
            autocomplete="off"
            spellcheck="false"
            :aria-invalid="Boolean(appIdError)"
            aria-describedby="lowcode-microfrontend-app-id-help"
            :disabled="busy"
            class="h-8 rounded border border-border bg-input px-2 font-mono text-sm text-surface outline-none focus:border-panel-focus disabled:opacity-50"
          />
          <span id="lowcode-microfrontend-app-id-help" :class="appIdError ? 'text-danger' : ''">
            {{ appIdError || 'Lowercase letters, numbers, dots, underscores, and hyphens.' }}
          </span>
        </label>

        <label class="flex flex-col gap-1 text-xs text-muted">
          Version
          <input
            v-model="version"
            data-test-id="lowcode-microfrontend-version"
            autocomplete="off"
            spellcheck="false"
            :aria-invalid="Boolean(versionError)"
            aria-describedby="lowcode-microfrontend-version-help"
            :disabled="busy"
            class="h-8 rounded border border-border bg-input px-2 font-mono text-sm text-surface outline-none focus:border-panel-focus disabled:opacity-50"
          />
          <span id="lowcode-microfrontend-version-help" :class="versionError ? 'text-danger' : ''">
            {{ versionError || 'Stable semantic version, for example 1.0.0.' }}
          </span>
        </label>

        <div class="rounded border border-border bg-hover/40 p-3 text-xs text-muted">
          The compiler uses a temporary snapshot of the current canvas, including unsaved edits.
          This first UI runs from a desktop development checkout; it will stop safely if the
          document uses a runtime feature that is not isolated for microfrontends yet.
        </div>

        <p v-if="!exportAvailable" class="text-xs text-danger" role="alert">
          {{ unavailableReason }}
        </p>
        <p v-else-if="i18nEnabled" class="text-xs text-danger" role="alert">
          Microfrontend packaging v1 does not isolate the i18n runtime yet. Turn off i18n in Preview
          settings before exporting.
        </p>
        <p
          v-else-if="status.kind === 'choosing'"
          class="flex items-center gap-2 text-xs text-muted"
          role="status"
          aria-live="polite"
        >
          <icon-lucide-loader-circle class="size-3.5 animate-spin" />
          Choose an empty output folder…
        </p>
        <p
          v-else-if="status.kind === 'snapshotting'"
          class="flex items-center gap-2 text-xs text-muted"
          role="status"
          aria-live="polite"
        >
          <icon-lucide-loader-circle class="size-3.5 animate-spin" />
          Preparing the current canvas snapshot…
        </p>
        <p
          v-else-if="status.kind === 'building'"
          class="flex items-start gap-2 text-xs text-muted"
          role="status"
          aria-live="polite"
        >
          <icon-lucide-loader-circle class="size-3.5 animate-spin" />
          <span class="min-w-0">
            Building the {{ targetLabel }} microfrontend…
            <span class="mt-0.5 block break-all text-[11px]">{{ status.outDir }}</span>
          </span>
        </p>
        <p
          v-else-if="status.kind === 'cancelling'"
          class="flex items-center gap-2 text-xs text-muted"
          role="status"
          aria-live="polite"
        >
          <icon-lucide-loader-circle class="size-3.5 animate-spin" />
          Cancelling and removing the temporary snapshot…
        </p>
        <div
          v-else-if="status.kind === 'done'"
          data-test-id="lowcode-microfrontend-export-success"
          class="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs"
          role="status"
          aria-live="polite"
        >
          <div class="font-medium text-emerald-500">Microfrontend ready</div>
          <div class="mt-1 break-all text-muted">{{ status.result.outDir }}</div>
          <div class="mt-1 text-muted">
            {{ status.result.files.length }} files · manifest sha256-{{
              status.result.manifestDigest.slice(0, 12)
            }}… · {{ status.result.manifestByteLength }} bytes
          </div>
          <div v-if="status.result.warningCount > 0" class="mt-1 text-amber-500">
            {{ status.result.warningCount }} compiler warning(s) require review.
          </div>
          <div v-if="status.cleanupWarning" class="mt-1 text-amber-500" role="alert">
            {{ status.cleanupWarning }}
          </div>
        </div>
        <p
          v-else-if="status.kind === 'error'"
          data-test-id="lowcode-microfrontend-export-error"
          class="rounded border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
          role="alert"
        >
          {{ status.message }}
        </p>
      </form>
    </AppDialogBody>
    <AppDialogFooter>
      <button
        type="button"
        class="h-8 cursor-pointer rounded px-3 text-xs font-medium text-surface hover:bg-hover"
        @click="busy ? cancel() : requestClose()"
      >
        {{ busy ? 'Cancel build' : 'Close' }}
      </button>
      <button
        type="button"
        data-test-id="lowcode-microfrontend-export-submit"
        :disabled="!canExport"
        class="flex h-8 cursor-pointer items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white disabled:cursor-default disabled:opacity-40"
        @click="submit"
      >
        <icon-lucide-loader-circle v-if="busy" class="size-3.5 animate-spin" />
        <icon-lucide-package-open v-else class="size-3.5" />
        {{ actionLabel }}
      </button>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
