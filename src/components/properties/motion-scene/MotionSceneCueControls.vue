<script setup lang="ts">
import NumberField from '@/components/inputs/NumberField.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import IconButton from '@/components/ui/IconButton.vue'

import {
  MOTION_SCENE_MIXED_NUMBER,
  useMotionSceneTimelineView
} from './use-motion-scene-timeline-view'

const scene = useMotionSceneTimelineView()
</script>

<template>
  <div v-if="scene.currentSequence?.cues.length" class="mt-2 rounded border border-border">
    <div class="flex items-center justify-between border-b border-border px-1.5 py-1">
      <button
        type="button"
        class="text-[9px] text-muted hover:text-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        data-test-id="motion-scene-select-all"
        @click="scene.selectAllCues"
      >
        {{
          scene.allCuesSelected
            ? scene.panels.motionSceneClearSelection
            : scene.panels.motionSceneSelectAllCues
        }}
      </button>
      <span class="text-[9px] tabular-nums text-muted">
        {{ scene.panels.motionSceneSelectedCount({ count: String(scene.selectedCues.length) }) }}
      </span>
    </div>
    <label
      v-for="cue in scene.currentSequence.cues"
      :key="cue.id"
      class="flex cursor-pointer items-center gap-1.5 border-b border-border/60 px-1.5 py-1 last:border-b-0 hover:bg-hover"
    >
      <input
        type="checkbox"
        class="size-3 accent-accent"
        :checked="scene.selectedCueIds.has(cue.id)"
        :aria-label="`${scene.cueTargetName(cue)} · ${scene.cueTrackName(cue)}`"
        @change="scene.selectCue(cue.id, true)"
        @keydown.stop
      />
      <span class="min-w-0 flex-1 truncate text-[9px] text-surface">
        {{ scene.cueTargetName(cue) }} · {{ scene.cueTrackName(cue) }}
      </span>
      <span v-if="cue.enabled === false" class="shrink-0 text-[8px] text-muted">
        {{ scene.panels.motionSceneDisabled }}
      </span>
      <span v-if="scene.cueHasIssue(cue.id)" class="shrink-0 text-warning" aria-hidden="true">
        !
      </span>
      <span class="shrink-0 text-[8px] tabular-nums text-muted">
        {{ scene.formatTime(cue.startMs) }}
      </span>
    </label>
  </div>

  <fieldset v-if="scene.selectedCues.length" class="mt-2 border-t border-border pt-2">
    <legend class="mb-1.5 text-[10px] font-medium text-surface">
      {{ scene.panels.motionSceneCueEditor }}
    </legend>
    <label class="mb-1.5 flex items-center gap-1.5 text-[9px] text-muted">
      <input
        type="checkbox"
        class="size-3 accent-accent"
        :checked="scene.autoKeyframeEnabled"
        data-test-id="motion-scene-auto-keyframe"
        @change="scene.toggleAutoKeyframe(($event.target as HTMLInputElement).checked)"
        @keydown.stop
      />
      <span>{{ scene.panels.motionAutoKeyframe }}</span>
    </label>
    <div v-if="scene.autoKeyframeEnabled" class="mb-1.5 flex items-center gap-1.5">
      <AppSelect
        v-model="scene.autoKeyframeChannel"
        :options="scene.autoKeyframeChannelOptions"
        :label="scene.panels.motionKeyframe"
        class="min-w-0 flex-1"
        data-test-id="motion-scene-auto-keyframe-channel"
      />
      <div class="w-24">
        <NumberField
          :model-value="scene.autoKeyframeValue ?? MOTION_SCENE_MIXED_NUMBER"
          :min="scene.autoKeyframeLimit.min"
          :max="scene.autoKeyframeLimit.max"
          :step="scene.autoKeyframeStep"
          :placeholder="scene.panels.mixed"
          :aria-label="scene.autoKeyframeChannelLabels[scene.autoKeyframeChannel]"
          data-test-id="motion-scene-auto-keyframe-value"
          @commit="scene.setAutoKeyframeValue($event)"
        />
      </div>
    </div>
    <div class="grid grid-cols-2 gap-1.5">
      <NumberField
        :model-value="scene.selectedStartMs ?? MOTION_SCENE_MIXED_NUMBER"
        :min="0"
        :max="3_600_000"
        :step="10"
        label="T"
        suffix="ms"
        :placeholder="scene.panels.mixed"
        :aria-label="scene.panels.motionSceneStart"
        data-test-id="motion-scene-cue-start"
        @commit="scene.setSelectedStartMs($event)"
      />
      <NumberField
        :model-value="scene.selectedTimeScale ?? MOTION_SCENE_MIXED_NUMBER"
        :min="0.01"
        :max="100"
        :step="0.1"
        label="×"
        :placeholder="scene.panels.mixed"
        :aria-label="scene.panels.motionSceneTimeScale"
        data-test-id="motion-scene-cue-time-scale"
        @commit="scene.setSelectedTimeScale($event)"
      />
      <label
        class="flex items-center justify-between rounded bg-input px-2 py-1 text-[9px] text-muted"
      >
        {{ scene.panels.motionSceneEnabled }}
        <AppSwitch
          :model-value="scene.selectedEnabled ?? false"
          :state="scene.selectedEnabled === null ? 'mixed' : 'idle'"
          :label="scene.panels.motionSceneEnabled"
          @update:model-value="scene.setSelectedEnabled"
        />
      </label>
      <button
        type="button"
        class="rounded bg-input px-2 py-1 text-[9px] text-muted outline-none hover:bg-danger/10 hover:text-danger focus-visible:ring-1 focus-visible:ring-danger"
        :disabled="!scene.canRemoveCues"
        data-test-id="motion-scene-delete-cues"
        @click="scene.deleteSelectedCues"
      >
        {{ scene.panels.motionSceneDeleteCues }}
      </button>
      <div class="flex min-w-0 items-center gap-1">
        <NumberField
          :model-value="scene.translateDeltaMs"
          :min="-3_600_000"
          :max="3_600_000"
          :step="10"
          label="Δ"
          suffix="ms"
          :aria-label="scene.panels.motionSceneTranslate"
          @update:model-value="scene.translateDeltaMs = $event"
        />
        <IconButton
          :label="scene.panels.motionSceneApplyTranslate"
          data-test-id="motion-scene-translate"
          @click="scene.translateSelected(scene.translateDeltaMs)"
        >
          <icon-lucide-move-horizontal class="size-3" aria-hidden="true" />
        </IconButton>
      </div>
      <div class="flex min-w-0 items-center gap-1">
        <NumberField
          :model-value="scene.scaleFactor"
          :min="0.01"
          :max="100"
          :step="0.1"
          label="×"
          :aria-label="scene.panels.motionSceneScale"
          @update:model-value="scene.scaleFactor = $event"
        />
        <IconButton
          :label="scene.panels.motionSceneApplyScale"
          data-test-id="motion-scene-scale"
          @click="scene.scaleSelected(scene.scaleFactor)"
        >
          <icon-lucide-scaling class="size-3" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  </fieldset>
</template>
