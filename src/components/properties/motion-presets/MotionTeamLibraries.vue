<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'

import { TEAM_MOTION_LIBRARY_LIMITS } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import {
  TEAM_MOTION_LIBRARY_STORE_LIMITS,
  reconcileTeamMotionTokenValues
} from '@/app/motion-presets'

import { useTeamMotionLibrary } from './use/team-motion-library'

const { panels } = useI18n()
const open = ref(false)
const tokenValues = reactive<Record<string, Record<string, number>>>({})
const {
  manifestJson,
  publicKeyPem,
  busyId,
  libraries,
  errorMessage,
  disabled,
  stageManifest,
  check,
  accept,
  reject,
  rollbackLatest,
  remove,
  apply,
  preview,
  stopPreview
} = useTeamMotionLibrary()

function libraryTokens(libraryId: string) {
  return (tokenValues[libraryId] ??= {})
}

watch(
  libraries,
  (currentLibraries) => {
    const activeIds = new Set<string>()
    for (const library of currentLibraries) {
      const manifest = library.registry.accepted.manifest
      activeIds.add(manifest.library.id)
      reconcileTeamMotionTokenValues(
        manifest.tokens ?? [],
        (tokenValues[manifest.library.id] ??= {})
      )
    }
    for (const id of Object.keys(tokenValues)) {
      if (!activeIds.has(id)) Reflect.deleteProperty(tokenValues, id)
    }
  },
  { immediate: true }
)
watch(open, (expanded) => {
  if (!expanded) stopPreview()
})
onBeforeUnmount(stopPreview)
</script>

<template>
  <div class="mt-2 border-t border-border pt-2" data-test-id="motion-team-libraries">
    <button
      type="button"
      class="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[10px] text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
      :aria-expanded="open"
      data-test-id="motion-team-toggle"
      @click="open = !open"
    >
      {{ panels.motionTeamLibraries }}
      <span>{{ libraries.length }}</span>
    </button>

    <div v-if="open" class="mt-1.5 space-y-1.5">
      <textarea
        v-model="manifestJson"
        rows="3"
        :maxlength="TEAM_MOTION_LIBRARY_LIMITS.maxJsonBytes"
        class="w-full resize-y rounded border border-border bg-input p-1.5 font-mono text-[10px] text-surface outline-none focus:border-accent"
        :placeholder="panels.motionTeamManifestPlaceholder"
        data-test-id="motion-team-manifest"
      />
      <textarea
        v-model="publicKeyPem"
        rows="2"
        :maxlength="TEAM_MOTION_LIBRARY_STORE_LIMITS.maxPublicKeyBytes"
        class="w-full resize-y rounded border border-border bg-input p-1.5 font-mono text-[9px] text-surface outline-none focus:border-accent"
        :placeholder="panels.motionTeamPublicKeyPlaceholder"
        data-test-id="motion-team-public-key"
      />
      <button
        type="button"
        class="w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
        :disabled="disabled || Boolean(busyId) || !manifestJson.trim() || !publicKeyPem.trim()"
        data-test-id="motion-team-stage"
        @click="stageManifest"
      >
        {{ panels.motionTeamVerifyImport }}
      </button>

      <div
        v-for="library in libraries"
        :key="library.registry.accepted.manifest.library.id"
        class="rounded border border-border bg-input p-2"
        :data-test-id="`motion-team-library-${library.registry.accepted.manifest.library.id}`"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-[10px] font-medium text-surface">
              {{ library.registry.accepted.manifest.library.name }}
            </p>
            <p class="truncate text-[9px] text-muted">
              {{ library.registry.accepted.manifest.publisher.name }} ·
              {{ library.registry.accepted.manifest.version }}
            </p>
          </div>
          <span class="shrink-0 rounded bg-panel px-1 py-0.5 text-[9px] text-muted">
            {{ library.registry.pending ? panels.motionTeamPending : panels.motionTeamVerified }}
          </span>
        </div>

        <div v-if="library.registry.accepted.manifest.tokens?.length" class="mt-1.5 space-y-1">
          <label
            v-for="token in library.registry.accepted.manifest.tokens"
            :key="token.id"
            class="flex items-center justify-between gap-2 text-[9px] text-muted"
          >
            <span class="truncate">{{ token.id }}</span>
            <input
              v-model.number="
                libraryTokens(library.registry.accepted.manifest.library.id)[token.id]
              "
              type="number"
              :min="token.min"
              :max="token.max"
              :disabled="disabled || Boolean(busyId)"
              class="w-20 rounded border border-border bg-panel px-1 py-0.5 text-right text-[9px] text-surface"
            />
          </label>
        </div>

        <div class="mt-1.5 space-y-1">
          <div
            v-for="entry in library.registry.accepted.manifest.entries"
            :key="entry.kind === 'preset' ? entry.preset.id : entry.recipe.id"
            class="flex items-center justify-between gap-2 rounded bg-panel px-1.5 py-1"
          >
            <span class="min-w-0 truncate text-[9px] text-surface">
              {{ entry.kind === 'preset' ? entry.preset.name : entry.recipe.name }}
            </span>
            <span class="flex shrink-0 gap-1">
              <button
                type="button"
                class="rounded px-1 text-[9px] text-muted hover:text-surface"
                :disabled="disabled || Boolean(busyId)"
                @pointerenter="
                  preview(
                    {
                      libraryId: library.registry.accepted.manifest.library.id,
                      entryId: entry.kind === 'preset' ? entry.preset.id : entry.recipe.id,
                      entry
                    },
                    libraryTokens(library.registry.accepted.manifest.library.id)
                  )
                "
                @pointerleave="stopPreview"
                @focus="
                  preview(
                    {
                      libraryId: library.registry.accepted.manifest.library.id,
                      entryId: entry.kind === 'preset' ? entry.preset.id : entry.recipe.id,
                      entry
                    },
                    libraryTokens(library.registry.accepted.manifest.library.id)
                  )
                "
                @blur="stopPreview"
              >
                {{ panels.motionTeamPreview }}
              </button>
              <button
                type="button"
                class="rounded bg-accent px-1 text-[9px] text-white"
                :disabled="disabled || Boolean(busyId)"
                :data-test-id="`motion-team-apply-${
                  entry.kind === 'preset' ? entry.preset.id : entry.recipe.id
                }`"
                @click="
                  apply(
                    {
                      libraryId: library.registry.accepted.manifest.library.id,
                      entryId: entry.kind === 'preset' ? entry.preset.id : entry.recipe.id,
                      entry
                    },
                    libraryTokens(library.registry.accepted.manifest.library.id)
                  )
                "
              >
                {{ panels.motionTeamApply }}
              </button>
            </span>
          </div>
        </div>

        <div
          v-if="library.registry.pending"
          class="mt-1 space-y-0.5 rounded border border-warning/30 bg-warning/10 p-1.5 text-[9px] text-warning"
          :data-test-id="`motion-team-review-${library.registry.accepted.manifest.library.id}`"
        >
          <p
            class="font-medium"
            :data-test-id="`motion-team-candidate-version-${library.registry.accepted.manifest.library.id}`"
          >
            {{ library.registry.accepted.manifest.version }} →
            {{ library.registry.pending.candidate.manifest.version }}
          </p>
          <p :data-test-id="`motion-team-added-${library.registry.accepted.manifest.library.id}`">
            + {{ library.registry.pending.diff.added.join(', ') || '—' }}
          </p>
          <p :data-test-id="`motion-team-updated-${library.registry.accepted.manifest.library.id}`">
            ~ {{ library.registry.pending.diff.updated.join(', ') || '—' }}
          </p>
          <p :data-test-id="`motion-team-removed-${library.registry.accepted.manifest.library.id}`">
            − {{ library.registry.pending.diff.removed.join(', ') || '—' }}
          </p>
        </div>
        <div class="mt-1.5 flex flex-wrap justify-end gap-1">
          <button
            type="button"
            class="rounded px-1 text-[9px] text-muted hover:text-surface disabled:opacity-50"
            :disabled="disabled || Boolean(busyId)"
            @click="check(library.registry.accepted.manifest.library.id)"
          >
            {{ panels.motionTeamCheck }}
          </button>
          <template v-if="library.registry.pending">
            <button
              type="button"
              class="rounded bg-accent px-1 text-[9px] text-white"
              :disabled="disabled || Boolean(busyId)"
              @click="accept(library.registry.accepted.manifest.library.id)"
            >
              {{ panels.motionTeamAccept }}
            </button>
            <button
              type="button"
              class="rounded px-1 text-[9px] text-muted hover:text-danger"
              :disabled="disabled || Boolean(busyId)"
              @click="reject(library.registry.accepted.manifest.library.id)"
            >
              {{ panels.motionTeamReject }}
            </button>
          </template>
          <button
            v-if="library.registry.history.length"
            type="button"
            class="rounded px-1 text-[9px] text-muted hover:text-surface"
            :disabled="disabled || Boolean(busyId)"
            @click="rollbackLatest(library.registry.accepted.manifest.library.id)"
          >
            {{ panels.motionTeamRollback }}
          </button>
          <button
            type="button"
            class="rounded px-1 text-[9px] text-muted hover:text-danger"
            :disabled="disabled || Boolean(busyId)"
            :data-test-id="`motion-team-remove-${library.registry.accepted.manifest.library.id}`"
            @click="remove(library.registry.accepted.manifest.library.id)"
          >
            {{ panels.motionTeamRemove }}
          </button>
        </div>
      </div>

      <p v-if="libraries.length === 0" class="text-[10px] text-muted">
        {{ panels.motionTeamEmpty }}
      </p>
      <p v-if="errorMessage" role="alert" class="text-[10px] leading-4 text-danger">
        {{ errorMessage }}
      </p>
    </div>
  </div>
</template>
