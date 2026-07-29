<script setup lang="ts">
import NumberField from '@/components/inputs/NumberField.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Tip from '@/components/ui/Tip.vue'

import { useMotionSceneTimelineView } from './use-motion-scene-timeline-view'

const scene = useMotionSceneTimelineView()
</script>

<template>
  <div
    class="overflow-x-auto rounded border border-border bg-input/50"
    data-test-id="motion-scene-viewport"
  >
    <div
      data-scene-timeline-content
      class="relative min-h-24 select-none overflow-hidden"
      :style="scene.timelineContentStyle"
      @pointerdown="scene.seekFromTimeline"
    >
      <div class="relative h-5 border-b border-border bg-panel/70">
        <span
          v-for="tick in scene.timelineTicks"
          :key="tick"
          class="pointer-events-none absolute inset-y-0 border-l border-border/80 pl-1 text-[8px] tabular-nums text-muted"
          :style="{ left: scene.timePosition(tick) }"
        >
          {{ scene.formatTime(tick) }}
        </span>
      </div>

      <div
        v-for="marker in scene.currentSequence?.markers ?? []"
        :key="marker.id"
        class="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-warning/70"
        :style="scene.markerStyle(marker)"
      >
        <span class="absolute top-0 -translate-x-1/2 text-[8px] text-warning">◆</span>
      </div>
      <div
        class="pointer-events-none absolute inset-y-0 z-30 w-px bg-accent"
        :style="scene.playheadStyle"
      />
      <Tip
        v-for="peer in scene.remoteTimelinePeers"
        :key="`remote-scene-playhead-${peer.clientId}`"
        :label="peer.name"
      >
        <div
          class="absolute inset-y-0 z-20 w-px"
          :style="scene.remotePlayheadStyle(peer)"
          data-test-id="motion-scene-remote-playhead"
        />
      </Tip>

      <div v-if="scene.currentSequence?.cues.length" class="space-y-1 p-1.5">
        <div v-for="cue in scene.currentSequence.cues" :key="cue.id" class="relative h-6">
          <button
            type="button"
            class="absolute inset-y-0 min-w-4 touch-none truncate rounded border px-1.5 text-left text-[9px] outline-none focus-visible:ring-1 focus-visible:ring-accent"
            :class="[
              scene.selectedCueIds.has(cue.id)
                ? 'border-accent bg-accent/25 text-surface'
                : 'border-border bg-panel text-muted hover:border-muted hover:text-surface',
              scene.remoteTimelinePeers.some((peer) => peer.motionTimeline?.cueIds.includes(cue.id))
                ? 'ring-1 ring-accent/60'
                : '',
              scene.cueHasIssue(cue.id) ? 'border-warning' : '',
              cue.enabled === false ? 'opacity-50 line-through' : 'cursor-ew-resize'
            ]"
            :style="scene.cueStyle(cue)"
            :aria-label="`${scene.cueTargetName(cue)} · ${scene.cueTrackName(cue)}`"
            :aria-pressed="scene.selectedCueIds.has(cue.id)"
            :data-test-id="`motion-scene-cue-${cue.id}`"
            @pointerdown.stop.prevent="scene.beginCueDrag($event, cue)"
            @pointermove.stop.prevent="scene.moveCueDrag"
            @pointerup.stop="scene.finishCueDrag"
            @pointercancel.stop="scene.finishCueDrag"
            @click.stop.prevent
            @keydown.left.stop.prevent="scene.nudgeCue(cue, -1, $event)"
            @keydown.right.stop.prevent="scene.nudgeCue(cue, 1, $event)"
            @keydown.delete.stop.prevent="scene.removeCueFromKeyboard(cue)"
            @keydown.backspace.stop.prevent="scene.removeCueFromKeyboard(cue)"
          >
            {{ scene.cueTargetName(cue) }} · {{ scene.cueTrackName(cue) }}
          </button>
        </div>
      </div>
      <p v-else class="px-2 py-7 text-center text-[10px] text-muted">
        {{ scene.panels.motionSceneNoCues }}
      </p>
    </div>
  </div>

  <div class="mt-1.5 flex items-center gap-1.5">
    <input
      :value="scene.visiblePlayheadMs"
      type="range"
      min="0"
      :max="scene.timelineDurationMs"
      step="1"
      class="h-4 min-w-0 flex-1 accent-accent"
      :aria-label="scene.panels.motionPlayhead"
      data-test-id="motion-scene-playhead"
      @input="scene.onPlayheadInput"
      @keydown.stop
    />
    <span class="w-14 text-right text-[9px] tabular-nums text-muted">
      {{ scene.formatTime(scene.visiblePlayheadMs) }}
    </span>
    <IconButton
      :label="scene.panels.motionSceneAddMarker"
      :disabled="!scene.canAddMarker"
      data-test-id="motion-scene-add-marker"
      @click="scene.addMarker"
    >
      <icon-lucide-flag class="size-3" aria-hidden="true" />
    </IconButton>
  </div>

  <div class="mt-1.5 grid grid-cols-2 gap-1.5">
    <label class="flex min-w-0 items-center gap-1.5 text-[9px] text-muted">
      <input
        v-model="scene.snapEnabled"
        type="checkbox"
        class="size-3 accent-accent"
        @keydown.stop
      />
      <span class="truncate">{{ scene.panels.motionSceneSnap }}</span>
    </label>
    <NumberField
      :model-value="scene.snapGridMs"
      :min="1"
      :max="3_600_000"
      :step="10"
      suffix="ms"
      :aria-label="scene.panels.motionSceneSnapGrid"
      data-test-id="motion-scene-snap-grid"
      @commit="scene.setSnapGridMs($event)"
    />
    <label class="col-span-2 flex items-center gap-2 text-[9px] text-muted">
      <span class="shrink-0">{{ scene.panels.motionSceneZoom }}</span>
      <input
        :value="scene.zoom"
        type="range"
        min="0.5"
        max="4"
        step="0.25"
        class="h-4 min-w-0 flex-1 accent-accent"
        :aria-label="scene.panels.motionSceneZoom"
        data-test-id="motion-scene-zoom"
        @input="scene.onZoomInput"
        @keydown.stop
      />
      <span class="w-7 text-right tabular-nums">{{ scene.zoom.toFixed(2) }}×</span>
    </label>
  </div>

  <div v-if="scene.currentSequence?.markers?.length" class="mt-2 flex flex-wrap gap-1">
    <span
      v-for="marker in scene.currentSequence.markers"
      :key="marker.id"
      class="inline-flex max-w-full items-center rounded border border-warning/30 bg-warning/10 text-[9px] text-warning"
    >
      <button
        type="button"
        class="max-w-28 truncate px-1.5 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-warning"
        :aria-label="`${scene.panels.motionSceneMarker}: ${marker.label}`"
        @click="scene.seek(marker.timeMs)"
      >
        {{ marker.label }} · {{ scene.formatTime(marker.timeMs) }}
      </button>
      <button
        type="button"
        class="rounded-r px-1 py-0.5 hover:bg-danger/10 hover:text-danger focus-visible:ring-1 focus-visible:ring-danger"
        :aria-label="scene.panels.motionSceneRemoveMarker"
        @click="scene.deleteMarker(marker.id)"
      >
        <icon-lucide-x class="size-2.5" aria-hidden="true" />
      </button>
    </span>
  </div>
</template>
