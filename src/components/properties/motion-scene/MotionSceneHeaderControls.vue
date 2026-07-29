<script setup lang="ts">
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'

import { useMotionSceneTimelineView } from './use-motion-scene-timeline-view'

const scene = useMotionSceneTimelineView()
</script>

<template>
  <div class="mb-2 flex items-center justify-between gap-2">
    <div class="min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="text-[11px] font-medium text-surface">
          {{ scene.panels.motionSceneTimeline }}
        </span>
        <span class="rounded bg-input px-1 text-[9px] text-muted">{{ scene.ownerKind }}</span>
      </div>
      <p class="truncate text-[9px] text-muted">{{ scene.owner?.name }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-0.5">
      <IconButton
        v-if="!scene.previewVisible"
        :label="scene.panels.motionPreview"
        :disabled="!scene.hasAuthoredScene || !scene.currentSequence?.cues.length"
        data-test-id="motion-scene-play"
        @click="scene.play"
      >
        <icon-lucide-play class="size-3" aria-hidden="true" />
      </IconButton>
      <IconButton
        v-else
        :label="scene.panels.motionStopPreview"
        :data-playing="scene.previewPlaying"
        data-test-id="motion-scene-stop"
        @click="scene.stopPreview"
      >
        <icon-lucide-square class="size-3" aria-hidden="true" />
      </IconButton>
      <IconButton
        :label="scene.panels.motionSceneAddSequence"
        :disabled="!scene.canAddSequence"
        data-test-id="motion-scene-add-sequence"
        @click="scene.createSequence"
      >
        <icon-lucide-list-plus class="size-3" aria-hidden="true" />
      </IconButton>
      <IconButton
        :label="scene.panels.motionSceneDeleteSequence"
        :disabled="!scene.canRemoveSequence"
        class="hover:bg-danger/10 hover:text-danger focus-visible:ring-danger"
        data-test-id="motion-scene-delete-sequence"
        @click="scene.deleteSequence"
      >
        <icon-lucide-trash-2 class="size-3" aria-hidden="true" />
      </IconButton>
    </div>
  </div>

  <p
    v-if="!scene.hasAuthoredScene"
    class="mb-2 rounded border border-border bg-input/50 px-2 py-1.5 text-[10px] leading-4 text-muted"
  >
    {{ scene.panels.motionSceneEmptyHint }}
  </p>

  <div class="mb-2 flex items-center gap-1.5">
    <AppSelect
      :model-value="scene.selectedSequenceId"
      :options="scene.sequenceOptions"
      :label="scene.panels.motionSceneSequence"
      class="min-w-0 flex-1"
      data-test-id="motion-scene-sequence"
      @update:model-value="scene.selectSequence"
    />
    <span class="shrink-0 text-[9px] tabular-nums text-muted">
      {{ scene.currentSequence?.cues.length ?? 0 }} {{ scene.panels.motionSceneCueShort }}
    </span>
  </div>

  <div class="mb-2 flex items-center gap-1.5">
    <AppSelect
      v-if="scene.availableTrackOptions.length"
      v-model="scene.availableTrackKey"
      :options="scene.availableTrackOptions"
      :label="scene.panels.motionSceneAvailableTrack"
      class="min-w-0 flex-1"
      data-test-id="motion-scene-available-track"
    />
    <p v-else class="min-w-0 flex-1 truncate text-[9px] text-muted">
      {{ scene.panels.motionSceneNoAvailableTracks }}
    </p>
    <IconButton
      :label="scene.panels.motionSceneAddCue"
      :disabled="!scene.canAddCue"
      data-test-id="motion-scene-add-cue"
      @click="scene.addCue"
    >
      <icon-lucide-plus class="size-3" aria-hidden="true" />
    </IconButton>
  </div>
</template>
