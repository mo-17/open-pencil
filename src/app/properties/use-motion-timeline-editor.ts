/* oxlint-disable eslint/max-lines -- One controller owns atomic selection, preview, undo, and collaborative presence while visual controls remain split. */
import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'

import {
  MOTION_LIMITS,
  upgradeMotionSpecV3,
  type MotionEasing,
  type MotionSpec,
  type MotionTrack,
  type MotionTrigger
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { useCollabInjected } from '@/app/collab/context'
import { useEditorStore } from '@/app/editor/active-store'
import {
  startMotionPathEditing,
  stopMotionPathEditing,
  syncMotionPathEditingKeyframe
} from '@/app/motion-path/editing'
import {
  addMotionCubicPathSegment,
  removeMotionCubicPathSegment,
  setMotionCubicPathEnabled,
  upgradeMotionPathToCubic
} from '@/app/motion-path/spec'

import { renameMotionTrackWithReferences, updateNodeMotionWithUndo } from './motion'
import {
  addMotionKeyframe,
  addMotionTrack,
  duplicateMotionKeyframe,
  duplicateMotionTrack,
  motionKeyframeTime,
  motionKeyframeTimes,
  motionOffsetAtTime,
  motionTimelineDuration,
  removeMotionKeyframe,
  removeMotionTrack,
  renameMotionTrack,
  reorderMotionTrack,
  setMotionKeyframeChannel,
  setMotionKeyframeEasing,
  setMotionKeyframeOffset,
  setMotionTrackExit,
  setMotionTrackComposition,
  setMotionTrackName,
  setMotionTrackTiming,
  setMotionTrackTrigger,
  type MotionChannel,
  type MotionTrackCompositionPatch,
  type MotionTrackTimingPatch
} from './motion/timeline'
import {
  addMotionPathPoint,
  removeMotionPathPoint,
  setMotionPathAutoRotate,
  setMotionPathEnabled,
  setMotionPathPoint,
  setMotionPathProgress,
  setMotionV2ColorChannelEnabled,
  setMotionV2ColorComponent,
  setMotionV2NumericChannel,
  setMotionV2NumericChannelEnabled,
  upgradeMotionSpecToV2,
  type MotionColorComponent,
  type MotionV2ColorChannel,
  type MotionV2NumericChannel
} from './motion/v2'
import { motionNodeAuthoringSupported, motionV2ChannelSupported } from './motion/v2-capabilities'
import { motionV2ColorDefault, motionV2NumericDefault } from './motion/v2-defaults'

const SAFE_TRACK_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const DANGEROUS_TRACK_IDS = new Set(['constructor', 'prototype', '__proto__', 'javascript'])

/** Shared state and mutations for the focused timeline controls. The visual
 * track surface, timing editor, and keyframe editor stay split into small Vue
 * components while this composable owns their single selection/playhead model. */
export function useMotionTimelineEditor(nodeId: () => string, motion: () => MotionSpec) {
  const store = useEditorStore()
  const componentInstance = getCurrentInstance()
  const collab = componentInstance ? useCollabInjected() : undefined
  const { panels } = useI18n()
  const selectedTrackId = ref(motion().tracks[0]?.id ?? '')
  const selectedKeyframeIndex = ref(0)
  const playheadMs = ref(0)
  const autoKeyframeEnabled = ref(false)
  const trackRenameError = ref<string | null>(null)

  const timelineDuration = computed(() => motionTimelineDuration(motion()))
  const selectedTrack = computed(() =>
    motion().tracks.find((track) => track.id === selectedTrackId.value)
  )
  const selectedKeyframe = computed(
    () => selectedTrack.value?.keyframes[selectedKeyframeIndex.value]
  )
  const totalKeyframes = computed(() =>
    motion().tracks.reduce((total, track) => total + track.keyframes.length, 0)
  )
  const authoringAllowed = computed(() => {
    void store.state.sceneVersion
    return motionNodeAuthoringSupported(store.graph.getNode(nodeId()))
  })
  const canAddTrack = computed(
    () =>
      authoringAllowed.value &&
      motion().tracks.length < MOTION_LIMITS.maxTracks &&
      totalKeyframes.value + 2 <= MOTION_LIMITS.maxKeyframes
  )
  const canRemoveTrack = computed(() => authoringAllowed.value && motion().tracks.length > 1)
  const canDuplicateTrack = computed(() => {
    const track = selectedTrack.value
    return Boolean(
      authoringAllowed.value &&
      track &&
      motion().tracks.length < MOTION_LIMITS.maxTracks &&
      totalKeyframes.value + track.keyframes.length <= MOTION_LIMITS.maxKeyframes
    )
  })
  const canMoveTrackUp = computed(() => {
    if (!authoringAllowed.value) return false
    const index = motion().tracks.findIndex((track) => track.id === selectedTrackId.value)
    return index > 0
  })
  const canMoveTrackDown = computed(() => {
    if (!authoringAllowed.value) return false
    const index = motion().tracks.findIndex((track) => track.id === selectedTrackId.value)
    return index !== -1 && index < motion().tracks.length - 1
  })
  const canAddKeyframe = computed(
    () =>
      authoringAllowed.value &&
      selectedTrack.value !== undefined &&
      totalKeyframes.value < MOTION_LIMITS.maxKeyframes
  )
  const canRemoveKeyframe = computed(() => {
    const track = selectedTrack.value
    return Boolean(
      authoringAllowed.value &&
      track &&
      selectedKeyframeIndex.value > 0 &&
      selectedKeyframeIndex.value < track.keyframes.length - 1
    )
  })
  const canDuplicateKeyframe = computed(
    () =>
      authoringAllowed.value &&
      selectedKeyframe.value !== undefined &&
      totalKeyframes.value < MOTION_LIMITS.maxKeyframes
  )
  const iterationsValue = computed(() => selectedTrack.value?.timing.iterations ?? 1)
  const selectedTrackPreviewVisible = computed(() =>
    store.hasMotionPreview(nodeId(), selectedTrackId.value)
  )
  const selectedTrackPreviewPlaying = computed(
    () => selectedTrackPreviewVisible.value && store.isMotionPreviewActive()
  )
  const pathEditorActive = computed(
    () =>
      store.state.motionPathEdit?.nodeId === nodeId() &&
      store.state.motionPathEdit.trackId === selectedTrackId.value
  )

  function authoringSupported(): boolean {
    return authoringAllowed.value
  }

  watch(
    () => nodeId(),
    (_nextNodeId, previousNodeId) => {
      stopMotionPathEditing(store, previousNodeId)
      store.stopMotionPreview()
      selectedTrackId.value = motion().tracks[0]?.id ?? ''
      selectedKeyframeIndex.value = 0
      playheadMs.value = 0
      trackRenameError.value = null
    },
    { flush: 'sync' }
  )

  watch(
    () =>
      [
        nodeId(),
        selectedTrackId.value,
        selectedKeyframe.value?.id ?? '',
        playheadMs.value,
        selectedTrackPreviewPlaying.value,
        store.state.motionPreview?.elapsedMs ?? -1
      ] as const,
    () => {
      collab?.updateMotionTimelinePresence({
        scope: 'node',
        ownerId: nodeId(),
        trackIds: selectedTrackId.value ? [selectedTrackId.value] : [],
        keyframeIds: selectedKeyframe.value?.id ? [selectedKeyframe.value.id] : [],
        cueIds: [],
        playheadMs: selectedTrackPreviewPlaying.value
          ? (store.state.motionPreview?.elapsedMs ?? playheadMs.value)
          : playheadMs.value,
        playing: selectedTrackPreviewPlaying.value
      })
    },
    { immediate: true }
  )
  if (componentInstance) {
    onBeforeUnmount(() => {
      collab?.updateMotionTimelinePresence(null)
      stopMotionPathEditing(store, nodeId())
    })
  }

  watch(
    () => motion(),
    () => {
      if (!motion().tracks.some((track) => track.id === selectedTrackId.value)) {
        selectedTrackId.value = motion().tracks[0]?.id ?? ''
        selectedKeyframeIndex.value = 0
      }
      const track = selectedTrack.value
      if (track) {
        selectedKeyframeIndex.value = Math.min(
          Math.max(0, selectedKeyframeIndex.value),
          track.keyframes.length - 1
        )
      }
      playheadMs.value = Math.min(playheadMs.value, timelineDuration.value)
      syncMotionPathEditingKeyframe(
        store,
        nodeId(),
        selectedTrackId.value,
        selectedKeyframeIndex.value
      )
    }
  )

  watch(
    () => [nodeId(), selectedTrackId.value, selectedKeyframeIndex.value] as const,
    ([currentNodeId, currentTrackId, currentKeyframeIndex]) =>
      syncMotionPathEditingKeyframe(store, currentNodeId, currentTrackId, currentKeyframeIndex),
    { flush: 'sync' }
  )

  function seek(spec = motion(), trackId = selectedTrackId.value): void {
    if (!authoringSupported()) return
    const track = spec.tracks.find((candidate) => candidate.id === trackId)
    if (!track || typeof store.seekMotionPreview !== 'function') return
    store.seekMotionPreview([nodeId()], track.trigger, playheadMs.value, {
      trackId,
      infiniteAsSingleCycle: true,
      holdFinalFrame: true
    })
  }

  function commit(next: MotionSpec, trackId = selectedTrackId.value, coalesceKey?: string): void {
    if (!authoringSupported()) return
    playheadMs.value = Math.min(playheadMs.value, motionTimelineDuration(next))
    const update = () => updateNodeMotionWithUndo(store, nodeId(), next, panels.value.motionUpdate)
    const changed = coalesceKey
      ? store.undo.runBatch(panels.value.motionUpdate, update, coalesceKey)
      : update()
    if (changed) {
      seek(next, trackId)
    }
  }

  function selectTrack(trackId: string): void {
    selectedTrackId.value = trackId
    selectedKeyframeIndex.value = 0
    trackRenameError.value = null
    seek(motion(), trackId)
  }

  function selectKeyframe(track: MotionTrack, index: number, timeMs?: number): void {
    selectedTrackId.value = track.id
    selectedKeyframeIndex.value = index
    const keyframe = track.keyframes.at(index)
    if (keyframe) playheadMs.value = timeMs ?? motionKeyframeTime(track, keyframe)
    seek(motion(), track.id)
  }

  function updatePlayhead(value: number): void {
    playheadMs.value = Number.isFinite(value)
      ? Math.min(timelineDuration.value, Math.max(0, value))
      : 0
    seek()
  }

  function seekFromPointer(event: PointerEvent, track: MotionTrack): void {
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    selectedTrackId.value = track.id
    playheadMs.value = ratio * timelineDuration.value
    const nearestIndex = track.keyframes.reduce((nearest, keyframe, index) => {
      const nearestFrame = track.keyframes.at(nearest)
      if (!nearestFrame) return index
      const distance = Math.min(
        ...motionKeyframeTimes(track, keyframe).map((time) => Math.abs(time - playheadMs.value))
      )
      const nearestDistance = Math.min(
        ...motionKeyframeTimes(track, nearestFrame).map((time) => Math.abs(time - playheadMs.value))
      )
      return distance < nearestDistance ? index : nearest
    }, 0)
    selectedKeyframeIndex.value = nearestIndex
    seek(motion(), track.id)
  }

  function createTrack(): void {
    if (!canAddTrack.value) return
    const current = selectedTrack.value
    const next = addMotionTrack(motion(), {
      trigger: current?.trigger ?? 'mount',
      durationMs: current?.timing.durationMs ?? 400,
      delayMs: current?.timing.delayMs ?? 0
    })
    const created = next.tracks.find(
      (track) => !motion().tracks.some((currentTrack) => currentTrack.id === track.id)
    )
    if (!created) return
    selectedTrackId.value = created.id
    selectedKeyframeIndex.value = 0
    commit(next, created.id)
  }

  function deleteTrack(): void {
    const track = selectedTrack.value
    if (!track || !canRemoveTrack.value) return
    const currentIndex = motion().tracks.findIndex((candidate) => candidate.id === track.id)
    const next = removeMotionTrack(motion(), track.id)
    const fallback = next.tracks.at(Math.min(currentIndex, next.tracks.length - 1))
    selectedTrackId.value = fallback?.id ?? ''
    selectedKeyframeIndex.value = 0
    commit(next, selectedTrackId.value)
  }

  function renameTrack(value: string): void {
    if (!authoringSupported()) return
    const track = selectedTrack.value
    if (!track) return
    const nextId = value.trim()
    if (!SAFE_TRACK_ID.test(nextId) || DANGEROUS_TRACK_IDS.has(nextId.toLowerCase())) {
      trackRenameError.value = panels.value.motionTrackRenameInvalid
      return
    }
    if (nextId !== track.id && motion().tracks.some((candidate) => candidate.id === nextId)) {
      trackRenameError.value = panels.value.motionTrackRenameDuplicate
      return
    }
    trackRenameError.value = null
    if (nextId === track.id) return
    const next = renameMotionTrack(motion(), track.id, nextId)
    selectedTrackId.value = nextId
    playheadMs.value = Math.min(playheadMs.value, motionTimelineDuration(next))
    if (
      renameMotionTrackWithReferences(
        store,
        nodeId(),
        next,
        track.id,
        nextId,
        panels.value.motionUpdate
      )
    ) {
      seek(next, nextId)
    }
  }

  function duplicateTrack(): void {
    const track = selectedTrack.value
    if (!track || !canDuplicateTrack.value) return
    const result = duplicateMotionTrack(motion(), track.id)
    selectedTrackId.value = result.trackId
    selectedKeyframeIndex.value = 0
    trackRenameError.value = null
    commit(result.spec, result.trackId)
  }

  function moveTrack(delta: -1 | 1): void {
    const track = selectedTrack.value
    if (!track) return
    const currentIndex = motion().tracks.findIndex((candidate) => candidate.id === track.id)
    if (currentIndex === -1) return
    commit(reorderMotionTrack(motion(), track.id, currentIndex + delta), track.id)
  }

  function createKeyframe(): void {
    const track = selectedTrack.value
    if (!track || !canAddKeyframe.value) return
    const result = addMotionKeyframe(
      motion(),
      track.id,
      motionOffsetAtTime(track, playheadMs.value)
    )
    selectedKeyframeIndex.value = result.index
    commit(result.spec)
  }

  function editableKeyframe(
    spec: MotionSpec,
    trackId: string
  ): { spec: MotionSpec; index: number } {
    if (!autoKeyframeEnabled.value) return { spec, index: selectedKeyframeIndex.value }
    const track = spec.tracks.find((candidate) => candidate.id === trackId)
    if (!track) throw new Error(`Unknown motion track: ${trackId}`)
    const result = addMotionKeyframe(spec, trackId, motionOffsetAtTime(track, playheadMs.value))
    selectedKeyframeIndex.value = result.index
    return result
  }

  function deleteKeyframe(): void {
    const track = selectedTrack.value
    if (!track || !canRemoveKeyframe.value) return
    const index = selectedKeyframeIndex.value
    const next = removeMotionKeyframe(motion(), track.id, index)
    selectedKeyframeIndex.value = Math.max(0, index - 1)
    commit(next)
  }

  function duplicateKeyframe(): void {
    const track = selectedTrack.value
    if (!track || !canDuplicateKeyframe.value) return
    const result = duplicateMotionKeyframe(motion(), track.id, selectedKeyframeIndex.value)
    selectedKeyframeIndex.value = result.index
    const nextTrack = result.spec.tracks.find((candidate) => candidate.id === track.id)
    const keyframe = nextTrack?.keyframes[result.index]
    if (nextTrack && keyframe) playheadMs.value = motionKeyframeTime(nextTrack, keyframe)
    commit(result.spec)
  }

  function updateOffset(value: number, coalesceKey?: string): void {
    const track = selectedTrack.value
    if (!track || !canRemoveKeyframe.value) return
    const next = setMotionKeyframeOffset(motion(), track.id, selectedKeyframeIndex.value, value)
    const nextTrack = next.tracks.find((candidate) => candidate.id === track.id)
    const keyframe = nextTrack?.keyframes[selectedKeyframeIndex.value]
    if (nextTrack && keyframe) playheadMs.value = motionKeyframeTime(nextTrack, keyframe)
    commit(next, track.id, coalesceKey)
  }

  function dragKeyframe(
    trackId: string,
    keyframeIndex: number,
    elapsedMs: number,
    coalesceKey: string
  ): void {
    if (!authoringSupported()) return
    const track = motion().tracks.find((candidate) => candidate.id === trackId)
    if (!track || keyframeIndex <= 0 || keyframeIndex >= track.keyframes.length - 1) return
    selectedTrackId.value = trackId
    selectedKeyframeIndex.value = keyframeIndex
    playheadMs.value = Math.min(timelineDuration.value, Math.max(0, elapsedMs))
    const offset = motionOffsetAtTime(track, playheadMs.value)
    const next = setMotionKeyframeOffset(motion(), trackId, keyframeIndex, offset)
    commit(next, trackId, coalesceKey)
  }

  function updateTrigger(value: MotionTrigger): void {
    const track = selectedTrack.value
    if (track) commit(setMotionTrackTrigger(motion(), track.id, value))
  }

  function updateTrackName(value: string): void {
    const track = selectedTrack.value
    if (track && motion().version === 3) commit(setMotionTrackName(motion(), track.id, value))
  }

  function updateComposition(patch: MotionTrackCompositionPatch): void {
    const track = selectedTrack.value
    if (track && motion().version === 3) {
      commit(setMotionTrackComposition(motion(), track.id, patch))
    }
  }

  function updateTiming(patch: MotionTrackTimingPatch): void {
    const track = selectedTrack.value
    if (track) commit(setMotionTrackTiming(motion(), track.id, patch))
  }

  function updateExit(value: NonNullable<MotionTrack['exit']>): void {
    const track = selectedTrack.value
    if (track) commit(setMotionTrackExit(motion(), track.id, value))
  }

  function updateEasing(value: MotionEasing | undefined, coalesceKey?: string): void {
    if (!value) return
    const track = selectedTrack.value
    if (track) {
      commit(setMotionTrackTiming(motion(), track.id, { easing: value }), track.id, coalesceKey)
    }
  }

  function updateKeyframeEasing(value: MotionEasing | undefined, coalesceKey?: string): void {
    const track = selectedTrack.value
    if (!track || !selectedKeyframe.value) return
    commit(
      setMotionKeyframeEasing(motion(), track.id, selectedKeyframeIndex.value, value),
      track.id,
      coalesceKey
    )
  }

  function upgradeVersion(): void {
    if (motion().version !== 1) return
    commit(upgradeMotionSpecToV2(motion()))
  }

  function upgradeCompositionVersion(): void {
    if (motion().version === 3) return
    commit(upgradeMotionSpecV3(motion()))
  }

  function commitStructuredSpec(next: MotionSpec, _undoLabel?: string): void {
    commit(next)
  }

  function advancedChannelContext(
    channel: MotionV2NumericChannel | MotionV2ColorChannel,
    requireSupport: boolean
  ) {
    const spec = motion()
    const track = selectedTrack.value
    if (!track || spec.version === 1) return undefined
    const node = store.graph.getNode(nodeId())
    if (requireSupport && !motionV2ChannelSupported(node, channel)) return undefined
    return { node, spec, track }
  }

  function toggleAdvancedNumeric(channel: MotionV2NumericChannel, enabled: boolean): void {
    const context = advancedChannelContext(channel, enabled)
    if (!context) return
    commit(
      setMotionV2NumericChannelEnabled(
        context.spec,
        context.track.id,
        channel,
        enabled,
        motionV2NumericDefault(context.node, channel)
      )
    )
  }

  function updateAdvancedNumeric(channel: MotionV2NumericChannel, value: number): void {
    const context = advancedChannelContext(channel, true)
    if (!context) return
    const editing = editableKeyframe(context.spec, context.track.id)
    commit(setMotionV2NumericChannel(editing.spec, context.track.id, editing.index, channel, value))
  }

  function toggleAdvancedColor(channel: MotionV2ColorChannel, enabled: boolean): void {
    const context = advancedChannelContext(channel, enabled)
    if (!context) return
    commit(
      setMotionV2ColorChannelEnabled(
        context.spec,
        context.track.id,
        channel,
        enabled,
        motionV2ColorDefault(context.node, channel)
      )
    )
  }

  function updateAdvancedColor(
    channel: MotionV2ColorChannel,
    component: MotionColorComponent,
    value: number
  ): void {
    const context = advancedChannelContext(channel, true)
    if (!context) return
    const editing = editableKeyframe(context.spec, context.track.id)
    commit(
      setMotionV2ColorComponent(
        editing.spec,
        context.track.id,
        editing.index,
        channel,
        component,
        value
      )
    )
  }

  function togglePath(enabled: boolean): void {
    const track = selectedTrack.value
    if (!track || motion().version === 1) return
    const node = store.graph.getNode(nodeId())
    if (!enabled) stopMotionPathEditing(store, nodeId())
    const next =
      motion().version === 3
        ? setMotionCubicPathEnabled(motion(), track.id, enabled, {
            x: node?.width ?? 100,
            y: 0
          })
        : setMotionPathEnabled(motion(), track.id, enabled, {
            x: node?.width ?? 100,
            y: 0
          })
    commit(next)
  }

  function updatePathProgress(value: number): void {
    const track = selectedTrack.value
    if (!track || motion().version === 1) return
    const editing = editableKeyframe(motion(), track.id)
    commit(setMotionPathProgress(editing.spec, track.id, editing.index, value))
  }

  function updatePathAutoRotate(checked: boolean): void {
    const track = selectedTrack.value
    if (!track || motion().version === 1) return
    commit(setMotionPathAutoRotate(motion(), track.id, checked))
  }

  function updatePathPoint(pointIndex: number, axis: 'x' | 'y', value: number): void {
    const track = selectedTrack.value
    if (!track || motion().version === 1) return
    commit(setMotionPathPoint(motion(), track.id, pointIndex, axis, value))
  }

  function createPathPoint(): void {
    const track = selectedTrack.value
    if (!track || motion().version === 1) return
    commit(addMotionPathPoint(motion(), track.id))
  }

  function deletePathPoint(pointIndex: number): void {
    const track = selectedTrack.value
    if (!track || motion().version === 1) return
    commit(removeMotionPathPoint(motion(), track.id, pointIndex))
  }

  function upgradePathToCubic(): void {
    const track = selectedTrack.value
    if (!track?.path || motion().version === 1) return
    const next = upgradeMotionPathToCubic(motion(), track.id)
    commit(next, track.id)
    startMotionPathEditing(store, nodeId(), track.id, selectedKeyframeIndex.value)
  }

  function togglePathEditor(): void {
    const track = selectedTrack.value
    if (!track) return
    if (pathEditorActive.value) {
      stopMotionPathEditing(store, nodeId())
      return
    }
    store.stopMotionPreview()
    startMotionPathEditing(store, nodeId(), track.id, selectedKeyframeIndex.value)
  }

  function createPathSegment(): void {
    const track = selectedTrack.value
    if (!track) return
    commit(addMotionCubicPathSegment(motion(), track.id), track.id)
  }

  function deletePathSegment(segmentIndex: number): void {
    const track = selectedTrack.value
    if (!track) return
    commit(removeMotionCubicPathSegment(motion(), track.id, segmentIndex), track.id)
  }

  function toggleInfinite(checked: boolean): void {
    updateTiming({ iterations: checked ? 'infinite' : 1 })
  }

  function toggleChannel(channel: MotionChannel, enabled: boolean): void {
    const track = selectedTrack.value
    if (!track) return
    const identity = channel === 'opacity' || channel === 'scaleX' || channel === 'scaleY' ? 1 : 0
    const editing = editableKeyframe(motion(), track.id)
    commit(
      setMotionKeyframeChannel(
        editing.spec,
        track.id,
        editing.index,
        channel,
        enabled ? identity : undefined
      )
    )
  }

  function updateChannel(channel: MotionChannel, value: number): void {
    const track = selectedTrack.value
    if (!track) return
    const editing = editableKeyframe(motion(), track.id)
    commit(setMotionKeyframeChannel(editing.spec, track.id, editing.index, channel, value))
  }

  function toggleAutoKeyframe(checked: boolean): void {
    autoKeyframeEnabled.value = checked
  }

  function previewSelectedTrack(): void {
    if (!authoringSupported()) return
    const track = selectedTrack.value
    if (!track) return
    store.previewMotion([nodeId()], track.trigger, {
      trackId: track.id,
      infiniteAsSingleCycle: true
    })
  }

  function stopSelectedTrackPreview(): void {
    if (selectedTrackPreviewVisible.value) store.stopMotionPreview()
  }

  return {
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
  }
}
