<script setup lang="ts">
import { computed } from 'vue'

import { colorToCSS } from '@open-pencil/core/color'
import type { MotionKeyframe, MotionSpec, MotionTrack } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import type { RemotePeer } from '@/app/collab/types'
import { motionKeyframeTimes } from '@/app/properties/motion/timeline'
import IconButton from '@/components/ui/IconButton.vue'
import Tip from '@/components/ui/Tip.vue'

const {
  motion,
  selectedTrackId,
  selectedKeyframeIndex,
  playheadMs,
  timelineDuration,
  autoKeyframeEnabled,
  canAddTrack,
  canRemoveTrack,
  canAddKeyframe,
  canRemoveKeyframe,
  previewVisible,
  previewPlaying,
  remotePeers
} = defineProps<{
  motion: MotionSpec
  selectedTrackId: string
  selectedKeyframeIndex: number
  playheadMs: number
  timelineDuration: number
  autoKeyframeEnabled: boolean
  canAddTrack: boolean
  canRemoveTrack: boolean
  canAddKeyframe: boolean
  canRemoveKeyframe: boolean
  previewVisible: boolean
  previewPlaying: boolean
  remotePeers: readonly RemotePeer[]
}>()

const emit = defineEmits<{
  addTrack: []
  removeTrack: []
  selectTrack: [trackId: string]
  selectKeyframe: [track: MotionTrack, index: number, timeMs: number]
  dragKeyframe: [trackId: string, index: number, timeMs: number, coalesceKey: string]
  seekTrack: [event: PointerEvent, track: MotionTrack]
  updatePlayhead: [value: number]
  toggleAutoKeyframe: [checked: boolean]
  addKeyframe: []
  removeKeyframe: []
  previewTrack: []
  stopTrackPreview: []
}>()

const { panels } = useI18n()
const hasInfiniteTrack = computed(() =>
  motion.tracks.some(
    (track) =>
      track.timing.iterations === 'infinite' ||
      (track.trigger === 'loop' && track.timing.iterations === undefined)
  )
)
let dragSequence = 0
let keyframeDrag:
  | {
      pointerId: number
      trackId: string
      keyframeIndex: number
      rail: HTMLElement
      startClientX: number
      coalesceKey: string
      moved: boolean
    }
  | undefined
let suppressedClick: string | undefined

function markerPosition(time: number): string {
  return `${Math.min(100, Math.max(0, (time / timelineDuration) * 100))}%`
}

function playheadPosition(): string {
  return `${Math.min(100, Math.max(0, (playheadMs / timelineDuration) * 100))}%`
}

function remoteTrackPeers(track: MotionTrack): readonly RemotePeer[] {
  return remotePeers.filter((peer) => peer.motionTimeline?.trackIds.includes(track.id))
}

function remotePlayheadStyle(peer: RemotePeer): Record<string, string> {
  const time = peer.motionTimeline?.playheadMs ?? 0
  return {
    left: `${Math.min(100, Math.max(0, (time / timelineDuration) * 100))}%`,
    background: colorToCSS(peer.color)
  }
}

function markerStyle(
  time: number,
  track: MotionTrack,
  keyframe: MotionKeyframe
): Record<string, string> {
  const peer = keyframe.id
    ? remoteTrackPeers(track).find((candidate) =>
        candidate.motionTimeline?.keyframeIds.includes(keyframe.id ?? '')
      )
    : undefined
  return {
    left: markerPosition(time),
    ...(peer ? { boxShadow: `0 0 0 2px ${colorToCSS(peer.color)}` } : {})
  }
}

function onPlayheadInput(event: Event): void {
  emit('updatePlayhead', Number((event.target as HTMLInputElement).value))
}

function onAutoKeyframeChange(event: Event): void {
  emit('toggleAutoKeyframe', (event.target as HTMLInputElement).checked)
}

function markerId(trackId: string, keyframeIndex: number): string {
  return `${trackId}:${keyframeIndex}`
}

function startKeyframeDrag(
  event: PointerEvent,
  track: MotionTrack,
  keyframeIndex: number,
  timeMs: number
): void {
  emit('selectKeyframe', track, keyframeIndex, timeMs)
  if (keyframeIndex === 0 || keyframeIndex === track.keyframes.length - 1) return
  const button = event.currentTarget as HTMLButtonElement
  const rail = button.parentElement
  if (!rail) return
  keyframeDrag = {
    pointerId: event.pointerId,
    trackId: track.id,
    keyframeIndex,
    rail,
    startClientX: event.clientX,
    coalesceKey: `motion-keyframe-drag:${track.id}:${keyframeIndex}:${++dragSequence}`,
    moved: false
  }
  button.setPointerCapture(event.pointerId)
}

function moveKeyframeDrag(event: PointerEvent): void {
  const drag = keyframeDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  if (!drag.moved && Math.abs(event.clientX - drag.startClientX) < 2) return
  drag.moved = true
  const rect = drag.rail.getBoundingClientRect()
  if (rect.width <= 0) return
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  emit('dragKeyframe', drag.trackId, drag.keyframeIndex, ratio * timelineDuration, drag.coalesceKey)
}

function finishKeyframeDrag(event: PointerEvent): void {
  const drag = keyframeDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  const button = event.currentTarget as HTMLButtonElement
  if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId)
  if (drag.moved) suppressedClick = markerId(drag.trackId, drag.keyframeIndex)
  keyframeDrag = undefined
}

function selectKeyframeFromClick(
  event: MouseEvent,
  track: MotionTrack,
  keyframeIndex: number,
  timeMs: number
): void {
  const id = markerId(track.id, keyframeIndex)
  if (suppressedClick === id) {
    suppressedClick = undefined
    event.preventDefault()
    return
  }
  emit('selectKeyframe', track, keyframeIndex, timeMs)
}
</script>

<template>
  <div class="mb-2 flex items-center justify-between gap-2">
    <div class="flex min-w-0 items-center gap-1.5">
      <div class="text-[11px] font-medium text-surface">{{ panels.motionTimeline }}</div>
      <span
        v-if="hasInfiniteTrack"
        class="rounded bg-input px-1 text-[9px] text-muted"
        :aria-label="panels.motionInfinite"
      >
        ∞ · 1×
      </span>
    </div>
    <div class="flex items-center gap-0.5">
      <IconButton
        v-if="!previewVisible"
        :label="`${panels.motionPreview} · ${panels.motionTrack}`"
        data-test-id="motion-preview-track"
        @click="emit('previewTrack')"
      >
        <icon-lucide-play class="size-3" />
      </IconButton>
      <IconButton
        v-else
        :label="`${panels.motionStopPreview} · ${panels.motionTrack}`"
        :data-playing="previewPlaying"
        data-test-id="motion-stop-track-preview"
        @click="emit('stopTrackPreview')"
      >
        <icon-lucide-square class="size-3" />
      </IconButton>
      <IconButton
        :label="panels.motionAddTrack"
        :disabled="!canAddTrack"
        data-test-id="motion-add-track"
        @click="emit('addTrack')"
      >
        <icon-lucide-list-plus class="size-3" />
      </IconButton>
      <IconButton
        :label="panels.motionRemoveTrack"
        :disabled="!canRemoveTrack"
        data-test-id="motion-remove-track"
        @click="emit('removeTrack')"
      >
        <icon-lucide-trash-2 class="size-3" />
      </IconButton>
    </div>
  </div>

  <div class="space-y-1" data-test-id="motion-track-list">
    <div
      v-for="(track, trackIndex) in motion.tracks"
      :key="track.id"
      class="flex min-w-0 items-center gap-1.5"
      :data-test-id="`motion-track-${track.id}`"
    >
      <button
        type="button"
        class="h-6 w-[72px] shrink-0 truncate rounded px-1.5 text-left text-[10px]"
        :class="
          track.id === selectedTrackId
            ? 'bg-accent/15 text-surface'
            : 'text-muted hover:bg-hover hover:text-surface'
        "
        @click="emit('selectTrack', track.id)"
        @keydown.stop
      >
        {{ trackIndex + 1 }} · {{ track.id }}
      </button>
      <div
        class="relative h-6 min-w-0 flex-1 cursor-crosshair rounded border border-border bg-input/70"
        role="presentation"
        @pointerdown="emit('seekTrack', $event, track)"
      >
        <div
          class="pointer-events-none absolute inset-y-0 z-10 w-px bg-accent"
          :style="{ left: playheadPosition() }"
        />
        <Tip
          v-for="peer in remoteTrackPeers(track)"
          :key="`remote-playhead-${peer.clientId}`"
          :label="peer.name"
        >
          <div
            class="absolute inset-y-0 z-10 w-px"
            :style="remotePlayheadStyle(peer)"
            data-test-id="motion-remote-playhead"
          />
        </Tip>
        <template v-for="(keyframe, keyframeIndex) in track.keyframes" :key="keyframeIndex">
          <button
            v-for="(time, occurrenceIndex) in motionKeyframeTimes(track, keyframe)"
            :key="`${track.id}-${keyframeIndex}-${occurrenceIndex}`"
            type="button"
            class="absolute top-1/2 z-20 size-2.5 touch-none -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border"
            :class="[
              track.id === selectedTrackId && keyframeIndex === selectedKeyframeIndex
                ? 'border-accent bg-accent'
                : 'border-muted bg-panel hover:border-surface',
              keyframeIndex > 0 && keyframeIndex < track.keyframes.length - 1
                ? 'cursor-ew-resize'
                : 'cursor-pointer'
            ]"
            :style="markerStyle(time, track, keyframe)"
            :aria-label="`${panels.motionKeyframe} ${keyframeIndex + 1}`"
            :data-test-id="
              occurrenceIndex === 0
                ? `motion-keyframe-${track.id}-${keyframeIndex}`
                : `motion-keyframe-${track.id}-${keyframeIndex}-${occurrenceIndex}`
            "
            @pointerdown.stop.prevent="startKeyframeDrag($event, track, keyframeIndex, time)"
            @pointermove.stop.prevent="moveKeyframeDrag"
            @pointerup.stop="finishKeyframeDrag"
            @pointercancel.stop="finishKeyframeDrag"
            @click.stop="selectKeyframeFromClick($event, track, keyframeIndex, time)"
            @keydown.stop
          />
        </template>
      </div>
    </div>
  </div>

  <div class="mt-2 flex items-center gap-2">
    <input
      :value="playheadMs"
      type="range"
      min="0"
      :max="timelineDuration"
      step="1"
      class="h-4 min-w-0 flex-1 accent-accent"
      :aria-label="panels.motionPlayhead"
      data-test-id="motion-playhead"
      @input="onPlayheadInput"
      @keydown.stop
    />
    <span class="w-[66px] text-right text-[10px] tabular-nums text-muted">
      {{ Math.round(playheadMs) }} / {{ Math.round(timelineDuration) }} ms
    </span>
  </div>

  <label
    class="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted"
    data-test-id="motion-auto-keyframe"
  >
    <input
      type="checkbox"
      class="size-3 accent-accent"
      :checked="autoKeyframeEnabled"
      @change="onAutoKeyframeChange"
      @keydown.stop
    />
    {{ panels.motionAutoKeyframe }}
  </label>

  <div class="mt-2 flex gap-1.5">
    <button
      type="button"
      class="h-7 flex-1 rounded border border-border bg-input px-2 text-[10px] text-surface hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="!canAddKeyframe"
      data-test-id="motion-add-keyframe"
      @click="emit('addKeyframe')"
      @keydown.stop
    >
      {{ panels.motionAddKeyframe }}
    </button>
    <button
      type="button"
      class="h-7 flex-1 rounded border border-border bg-input px-2 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="!canRemoveKeyframe"
      data-test-id="motion-remove-keyframe"
      @click="emit('removeKeyframe')"
      @keydown.stop
    >
      {{ panels.motionRemoveKeyframe }}
    </button>
  </div>
</template>
