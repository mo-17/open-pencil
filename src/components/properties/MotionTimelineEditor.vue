<script setup lang="ts">
import { computed } from 'vue'

import type { MotionSpec, SceneNode } from '@open-pencil/scene-graph'

import { useCollabInjected } from '@/app/collab/context'
import { useMotionTimelineEditor } from '@/app/properties/use-motion-timeline-editor'
import MotionKeyframeControls from '@/components/properties/MotionKeyframeControls.vue'
import MotionTimelineTracks from '@/components/properties/MotionTimelineTracks.vue'
import MotionTrackControls from '@/components/properties/MotionTrackControls.vue'

const { node, nodeId, motion } = defineProps<{
  node: SceneNode
  nodeId: string
  motion: MotionSpec
}>()
const collab = useCollabInjected()
const remoteTimelinePeers = computed(
  () =>
    collab?.remotePeers.value.filter(
      (peer) => peer.motionTimeline?.scope === 'node' && peer.motionTimeline.ownerId === nodeId
    ) ?? []
)

const {
  selectedTrackId,
  selectedKeyframeIndex,
  playheadMs,
  autoKeyframeEnabled,
  timelineDuration,
  selectedTrack,
  selectedKeyframe,
  canAddTrack,
  canRemoveTrack,
  canDuplicateTrack,
  canMoveTrackUp,
  canMoveTrackDown,
  canAddKeyframe,
  canRemoveKeyframe,
  canDuplicateKeyframe,
  trackRenameError,
  iterationsValue,
  selectedTrackPreviewVisible,
  selectedTrackPreviewPlaying,
  pathEditorActive,
  selectTrack,
  selectKeyframe,
  updatePlayhead,
  seekFromPointer,
  createTrack,
  deleteTrack,
  renameTrack,
  duplicateTrack,
  moveTrack,
  createKeyframe,
  deleteKeyframe,
  duplicateKeyframe,
  updateOffset,
  dragKeyframe,
  updateTrigger,
  updateTrackName,
  updateComposition,
  updateTiming,
  updateExit,
  updateEasing,
  updateKeyframeEasing,
  upgradeVersion,
  upgradeCompositionVersion,
  toggleAdvancedNumeric,
  updateAdvancedNumeric,
  toggleAdvancedColor,
  updateAdvancedColor,
  commitStructuredSpec,
  togglePath,
  updatePathProgress,
  updatePathAutoRotate,
  updatePathPoint,
  createPathPoint,
  deletePathPoint,
  upgradePathToCubic,
  togglePathEditor,
  createPathSegment,
  deletePathSegment,
  toggleInfinite,
  toggleChannel,
  updateChannel,
  toggleAutoKeyframe,
  previewSelectedTrack,
  stopSelectedTrackPreview
} = useMotionTimelineEditor(
  () => nodeId,
  () => motion
)
</script>

<template>
  <section data-test-id="motion-timeline" class="mt-3 border-t border-border pt-3">
    <MotionTimelineTracks
      :motion="motion"
      :selected-track-id="selectedTrackId"
      :selected-keyframe-index="selectedKeyframeIndex"
      :playhead-ms="playheadMs"
      :timeline-duration="timelineDuration"
      :auto-keyframe-enabled="autoKeyframeEnabled"
      :can-add-track="canAddTrack"
      :can-remove-track="canRemoveTrack"
      :can-add-keyframe="canAddKeyframe"
      :can-remove-keyframe="canRemoveKeyframe"
      :preview-visible="selectedTrackPreviewVisible"
      :preview-playing="selectedTrackPreviewPlaying"
      :remote-peers="remoteTimelinePeers"
      @add-track="createTrack"
      @remove-track="deleteTrack"
      @select-track="selectTrack"
      @select-keyframe="selectKeyframe"
      @drag-keyframe="dragKeyframe"
      @seek-track="seekFromPointer"
      @update-playhead="updatePlayhead"
      @toggle-auto-keyframe="toggleAutoKeyframe"
      @add-keyframe="createKeyframe"
      @remove-keyframe="deleteKeyframe"
      @preview-track="previewSelectedTrack"
      @stop-track-preview="stopSelectedTrackPreview"
    />

    <MotionTrackControls
      v-if="selectedTrack"
      :track="selectedTrack"
      :motion-version="motion.version"
      :iterations-value="iterationsValue"
      :can-duplicate="canDuplicateTrack"
      :can-move-up="canMoveTrackUp"
      :can-move-down="canMoveTrackDown"
      :rename-error="trackRenameError"
      @rename="renameTrack"
      @duplicate="duplicateTrack"
      @move="moveTrack"
      @update-trigger="updateTrigger"
      @update-name="updateTrackName"
      @update-composition="updateComposition"
      @upgrade-composition="upgradeCompositionVersion"
      @update-timing="updateTiming"
      @update-exit="updateExit"
      @update-easing="updateEasing"
      @toggle-infinite="toggleInfinite"
    />

    <MotionKeyframeControls
      v-if="selectedTrack && selectedKeyframe"
      :node="node"
      :motion="motion"
      :keyframe="selectedKeyframe"
      :track="selectedTrack"
      :motion-version="motion.version"
      :keyframe-index="selectedKeyframeIndex"
      :path-editor-active="pathEditorActive"
      :can-edit-offset="canRemoveKeyframe"
      :can-duplicate="canDuplicateKeyframe"
      @duplicate="duplicateKeyframe"
      @update-offset="updateOffset"
      @toggle-channel="toggleChannel"
      @update-channel="updateChannel"
      @update-easing="updateKeyframeEasing"
      @upgrade-version="upgradeVersion"
      @toggle-advanced-numeric="toggleAdvancedNumeric"
      @update-advanced-numeric="updateAdvancedNumeric"
      @toggle-advanced-color="toggleAdvancedColor"
      @update-advanced-color="updateAdvancedColor"
      @commit-structured="commitStructuredSpec"
      @toggle-path="togglePath"
      @update-path-progress="updatePathProgress"
      @update-path-auto-rotate="updatePathAutoRotate"
      @update-path-point="updatePathPoint"
      @add-path-point="createPathPoint"
      @remove-path-point="deletePathPoint"
      @upgrade-path-to-cubic="upgradePathToCubic"
      @toggle-path-editor="togglePathEditor"
      @add-path-segment="createPathSegment"
      @remove-path-segment="deletePathSegment"
    />
  </section>
</template>
