<script setup lang="ts">
import { ref } from 'vue'

import {
  SHARED_MOTION_PRESET_LIMITS,
  type SharedMotionPresetLibraryState
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import Tip from '@/components/ui/Tip.vue'

const {
  libraries,
  busyId = '',
  disabled = false
} = defineProps<{
  libraries: readonly SharedMotionPresetLibraryState[]
  busyId?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'accept-json': [json: string]
  check: [libraryId: string]
  accept: [libraryId: string]
  remove: [libraryId: string]
}>()

const { panels } = useI18n()
const open = ref(false)
const manifestJSON = ref('')

function acceptJSON(): void {
  const json = manifestJSON.value.trim()
  if (json) emit('accept-json', json)
}
</script>

<template>
  <div class="mt-2 border-t border-border pt-2" data-test-id="motion-shared-libraries">
    <button
      type="button"
      class="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[10px] text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
      data-test-id="motion-shared-toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ panels.motionPresetSharedLibraries }}
      <span>{{ libraries.length }}</span>
    </button>

    <div v-if="open" class="mt-1.5 space-y-1.5">
      <textarea
        v-model="manifestJSON"
        rows="3"
        :maxlength="SHARED_MOTION_PRESET_LIMITS.maxManifestJsonBytes"
        class="w-full resize-y rounded border border-border bg-input p-1.5 font-mono text-[10px] text-surface outline-none focus:border-accent"
        :placeholder="panels.motionPresetSharedPastePlaceholder"
        :aria-label="panels.motionPresetSharedManifestAria"
        data-test-id="motion-shared-json-input"
      />
      <button
        type="button"
        class="w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
        data-test-id="motion-shared-accept-json"
        :disabled="disabled || !manifestJSON.trim()"
        @click="acceptJSON"
      >
        {{ panels.motionPresetSharedAcceptManifest }}
      </button>

      <div
        v-for="library in libraries"
        :key="library.manifest.library.id"
        class="rounded border border-border bg-input p-2"
        :data-test-id="`motion-shared-library-${library.manifest.library.id}`"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-[10px] font-medium text-surface">
              {{ library.manifest.library.name }}
            </p>
            <p class="truncate text-[9px] text-muted">
              {{ library.manifest.publisher.name }} · {{ panels.motionPresetSharedReadonly }}
            </p>
          </div>
          <span
            class="shrink-0 rounded px-1 py-0.5 text-[9px]"
            :class="library.updateAvailable ? 'bg-warning/15 text-warning' : 'bg-panel text-muted'"
            :data-test-id="`motion-shared-status-${library.manifest.library.id}`"
          >
            {{
              library.updateAvailable
                ? panels.motionPresetSharedUpdateAvailable
                : panels.motionPresetSharedUpToDate
            }}
          </span>
        </div>

        <Tip :label="library.manifest.source.ref">
          <p
            class="mt-1 truncate text-[9px] text-muted"
            :data-test-id="`motion-shared-source-${library.manifest.library.id}`"
          >
            {{ library.manifest.source.kind }} · {{ library.manifest.source.ref }}
          </p>
        </Tip>
        <p class="mt-0.5 text-[9px] text-muted">
          {{ panels.motionPresetSharedAcceptedVersion }} {{ library.manifest.sourceVersion }}
          <template v-if="library.sourceVersion !== library.manifest.sourceVersion">
            · {{ panels.motionPresetSharedSourceVersion }} {{ library.sourceVersion }}
          </template>
        </p>

        <div class="mt-1.5 flex justify-end gap-1">
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-panel hover:text-surface disabled:opacity-50"
            :data-test-id="`motion-shared-check-${library.manifest.library.id}`"
            :disabled="disabled || busyId === library.manifest.library.id"
            @click="emit('check', library.manifest.library.id)"
          >
            {{
              busyId === library.manifest.library.id
                ? panels.motionPresetSharedChecking
                : panels.motionPresetSharedCheck
            }}
          </button>
          <button
            v-if="library.updateAvailable"
            type="button"
            class="rounded bg-accent px-1.5 py-0.5 text-[10px] text-white hover:bg-accent/90 disabled:opacity-50"
            :data-test-id="`motion-shared-accept-${library.manifest.library.id}`"
            :disabled="disabled || busyId === library.manifest.library.id"
            @click="emit('accept', library.manifest.library.id)"
          >
            {{ panels.motionPresetSharedAcceptUpdate }}
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50"
            :data-test-id="`motion-shared-remove-${library.manifest.library.id}`"
            :disabled="disabled || Boolean(busyId)"
            @click="emit('remove', library.manifest.library.id)"
          >
            {{ panels.motionPresetSharedRemove }}
          </button>
        </div>
      </div>

      <p v-if="libraries.length === 0" class="text-[10px] text-muted">
        {{ panels.motionPresetSharedEmpty }}
      </p>
    </div>
  </div>
</template>
