<script setup lang="ts">
import { computed } from 'vue'

import { IS_TAURI } from '@open-pencil/core/constants'
import { useCodeMessages } from '@open-pencil/vue'

import type { PreviewRefreshPolicy } from '../compile-scheduler'
import { previewSyncDescription } from '../sync-copy'
import SyncModeSelect from '../SyncModeSelect.vue'
import { useFlutterNativePreview } from './use'

const policy = defineModel<PreviewRefreshPolicy>({ required: true })
const messages = useCodeMessages()
const { devices, deviceId, state, busy, error, progress, warnings, discover, start, reload, stop } =
  useFlutterNativePreview(policy)
const running = computed(() => state.value.phase === 'running' || state.value.phase === 'reloading')
const phaseLabel = computed(
  () =>
    ({
      idle: messages.value.flutterPreviewIdle,
      preparing: messages.value.flutterPreviewPreparing,
      running: messages.value.flutterPreviewRunning,
      reloading: messages.value.flutterPreviewReloading,
      stopping: messages.value.flutterPreviewStopping,
      failed: messages.value.flutterPreviewFailed
    })[state.value.phase]
)
</script>

<template>
  <details
    class="shrink-0 border-b border-border px-3 py-2 text-xs"
    data-test-id="flutter-preview-controls"
  >
    <summary class="cursor-pointer text-surface">
      {{ messages.flutterPreview }}
      <span
        class="ml-2 text-muted"
        data-test-id="flutter-preview-phase"
        :data-phase="state.phase"
        >{{ phaseLabel }}</span
      >
    </summary>
    <p class="mt-2 text-[11px] text-muted">{{ messages.flutterPreviewDescription }}</p>
    <p v-if="!IS_TAURI" class="mt-2 text-[11px] text-muted">
      {{ messages.flutterPreviewDesktopOnly }}
    </p>
    <template v-else>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-2 text-muted">
          {{ messages.flutterPreviewDevices }}
          <select
            v-model="deviceId"
            :disabled="busy || running"
            data-test-id="flutter-preview-device"
            class="h-7 max-w-52 rounded border border-border bg-input px-2 text-surface disabled:opacity-50"
          >
            <option v-for="device in devices" :key="device.id" :value="device.id">
              {{ device.name }}
            </option>
          </select>
        </label>
        <button
          type="button"
          :disabled="busy || running"
          class="rounded border border-border px-2 py-1 text-surface disabled:opacity-50"
          data-test-id="flutter-preview-discover"
          @click="discover"
        >
          {{ messages.flutterPreviewDiscover }}
        </button>
        <button
          type="button"
          :disabled="busy || running || !deviceId"
          class="rounded bg-accent px-2 py-1 text-white disabled:opacity-50"
          data-test-id="flutter-preview-start"
          @click="start"
        >
          {{ messages.flutterPreviewStart }}
        </button>
        <button
          type="button"
          :disabled="!running"
          class="rounded border border-border px-2 py-1 text-surface disabled:opacity-50"
          data-test-id="flutter-preview-reload"
          @click="reload"
        >
          {{ messages.flutterPreviewReload }}
        </button>
        <button
          type="button"
          :disabled="state.phase === 'idle' || state.phase === 'stopping'"
          class="rounded border border-border px-2 py-1 text-surface disabled:opacity-50"
          data-test-id="flutter-preview-stop"
          @click="stop"
        >
          {{ messages.flutterPreviewStop }}
        </button>
      </div>
      <p v-if="!devices.length && !busy" class="mt-2 text-[11px] text-muted">
        {{ messages.flutterPreviewNoDevices }}
      </p>
      <label class="mt-2 flex items-center gap-2 text-muted">
        {{ messages.previewSyncMode }}
        <SyncModeSelect v-model="policy" data-test-id="flutter-preview-sync-policy" />
      </label>
      <p class="mt-1 text-[11px] text-muted">{{ previewSyncDescription(messages, policy) }}</p>
      <p class="mt-1 text-[11px] text-muted">{{ messages.flutterPreviewStatePreserved }}</p>
      <p
        v-if="state.revision !== null"
        class="mt-1 text-[11px] text-muted"
        data-test-id="flutter-preview-revision"
      >
        {{ messages.flutterPreviewRevision }}: {{ state.revision }}
      </p>
      <p v-if="progress" class="mt-2 text-[11px] text-muted" role="status">{{ progress }}</p>
      <details v-if="warnings.length" class="mt-2 text-[11px] text-warning">
        <summary>{{ messages.flutterPreviewWarnings }} ({{ warnings.length }})</summary>
        <ul class="mt-1 space-y-1">
          <li v-for="(warning, index) in warnings" :key="index">
            {{ warning.code }}: {{ warning.message }}
          </li>
        </ul>
      </details>
      <p
        v-if="error"
        class="mt-2 text-[11px] text-error"
        role="alert"
        data-test-id="flutter-preview-error"
      >
        {{ error }}
      </p>
    </template>
  </details>
</template>
