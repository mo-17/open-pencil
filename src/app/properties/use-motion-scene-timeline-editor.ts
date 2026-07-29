/* oxlint-disable eslint/max-lines -- Scene choreography keeps one atomic selection, preview, undo, and collaborative presence controller. */
import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'

import { prepareMotionScenePlan, type MotionScenePlanIssue } from '@open-pencil/core/motion'
import {
  MOTION_SCENE_LIMITS,
  type MotionSceneCue,
  type MotionSceneSpec,
  type MotionSceneSequence,
  type SceneNode
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { useCollabInjected } from '@/app/collab/context'
import { useEditorStore } from '@/app/editor/active-store'
import {
  addMotionSceneCue,
  addMotionSceneMarker,
  addMotionSceneSequence,
  autoKeyframeMotionSceneCues,
  collectMotionSceneAvailableTracks,
  createMotionSceneSpec,
  motionSceneCueTrackOffsetAtTime,
  motionSceneTrackDurationMs,
  removeMotionSceneCues,
  removeMotionSceneMarker,
  removeMotionSceneSequence,
  scaleMotionSceneCues,
  snapMotionSceneTime,
  translateMotionSceneCues,
  updateMotionSceneCues,
  updateMotionSceneWithUndo
} from '@/app/properties/motion/scene-timeline'
import { addMotionKeyframe, type MotionChannel } from '@/app/properties/motion/timeline'

const MIN_TIMELINE_DURATION_MS = 1_000
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
interface PreviewContext {
  ownerNodeId: string
  sequenceId: string
  previewId: number
}

function isSceneOwner(node: SceneNode | undefined): node is SceneNode {
  return node?.type === 'CANVAS' || node?.type === 'FRAME'
}

function finiteNumber(value: string | number, fallback: number): number {
  const normalized = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

function bounded(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function sharedNumber(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const first = values[0]
  return values.every((value) => value === first) ? first : null
}

function niceTickStep(durationMs: number, zoom: number): number {
  const target = Math.max(1, durationMs / Math.max(4, Math.round(6 * zoom)))
  const exponent = 10 ** Math.floor(Math.log10(target))
  const fraction = target / exponent
  let nice = 10
  if (fraction <= 1) nice = 1
  else if (fraction <= 2) nice = 2
  else if (fraction <= 5) nice = 5
  return nice * exponent
}

/** Page/frame choreography; selected-cue edits write one owner snapshot and one undo entry. */
export function useMotionSceneTimelineEditor() {
  const store = useEditorStore()
  const componentInstance = getCurrentInstance()
  const collab = componentInstance ? useCollabInjected() : undefined
  const { panels } = useI18n()
  const selectedSequenceId = ref('')
  const selectedCueIds = ref<Set<string>>(new Set())
  const availableTrackKey = ref('')
  const playheadMs = ref(0)
  const zoom = ref(1)
  const snapEnabled = ref(true)
  const snapGridMs = ref(100)
  const autoKeyframeEnabled = ref(false)
  const autoKeyframeChannel = ref<MotionChannel>('x')
  const errorMessage = ref<string | null>(null)
  const previewContext = ref<PreviewContext | null>(null)

  const owner = computed(() => {
    void store.state.sceneVersion
    const selected = store.selectedNode.value
    if (isSceneOwner(selected)) return store.graph.getNode(selected.id)
    const page = store.graph.getNode(store.state.currentPageId)
    return isSceneOwner(page) ? page : undefined
  })
  const ownerId = computed(() => owner.value?.id ?? '')
  const hasAuthoredScene = computed(() => {
    void store.state.sceneVersion
    return store.graph.getNode(ownerId.value)?.motionScene !== undefined
  })
  const scene = computed<MotionSceneSpec>(() => {
    // Page/frame metadata changes do not change selection. Read the reactive graph version here,
    // then resolve the owner afresh so cue edits are visible in the same mounted panel.
    void store.state.sceneVersion
    return store.graph.getNode(ownerId.value)?.motionScene ?? createMotionSceneSpec()
  })
  const sequences = computed(() => scene.value.sequences)
  const currentSequence = computed<MotionSceneSequence | undefined>(() =>
    sequences.value.find(({ id }) => id === selectedSequenceId.value)
  )

  const availableTracks = computed(() => {
    void store.state.sceneVersion
    if (!owner.value || !currentSequence.value) return []
    return collectMotionSceneAvailableTracks(
      store.graph,
      owner.value.id,
      scene.value,
      currentSequence.value.id
    )
  })

  const selectedCues = computed(() => {
    const selected = selectedCueIds.value
    return currentSequence.value?.cues.filter(({ id }) => selected.has(id)) ?? []
  })
  const selectedStartMs = computed(() =>
    sharedNumber(selectedCues.value.map(({ startMs }) => startMs))
  )
  const selectedTimeScale = computed(() =>
    sharedNumber(selectedCues.value.map(({ timeScale }) => timeScale ?? 1))
  )
  const selectedEnabled = computed<boolean | null>(() => {
    const values = selectedCues.value.map(({ enabled }) => enabled !== false)
    if (values.length === 0) return null
    const first = values[0]
    return values.every((value) => value === first) ? first : null
  })
  const autoKeyframeValue = computed<number | null>(() => {
    const channel = autoKeyframeChannel.value
    const values: number[] = []
    for (const cue of selectedCues.value) {
      const motion = store.graph.getNode(cue.targetNodeId)?.motion
      const track = motion?.tracks.find(({ id }) => id === cue.trackId)
      if (!motion || !track) return null
      try {
        const inserted = addMotionKeyframe(
          motion,
          cue.trackId,
          motionSceneCueTrackOffsetAtTime(cue, track, playheadMs.value)
        )
        const keyframe = inserted.spec.tracks.find(({ id }) => id === cue.trackId)?.keyframes[
          inserted.index
        ]
        if (!keyframe) return null
        values.push(
          keyframe[channel] ??
            (channel === 'opacity' || channel === 'scaleX' || channel === 'scaleY' ? 1 : 0)
        )
      } catch {
        return null
      }
    }
    return sharedNumber(values)
  })

  function resolveSceneTarget(targetNodeId: string) {
    const sceneOwner = owner.value
    const target = store.graph.getNode(targetNodeId)
    if (
      !sceneOwner ||
      !target ||
      target.id === sceneOwner.id ||
      !store.graph.isDescendant(target.id, sceneOwner.id)
    ) {
      return undefined
    }
    return { nodeId: target.id, motion: target.motion }
  }

  const scenePlan = computed(() => {
    void store.state.sceneVersion
    const sequence = currentSequence.value
    if (!owner.value || !sequence) return undefined
    return prepareMotionScenePlan(scene.value, sequence.id, resolveSceneTarget, {
      infiniteAsSingleCycle: true,
      holdFinalFrame: true
    })
  })
  const plannerIssues = computed<readonly MotionScenePlanIssue[]>(
    () => scenePlan.value?.issues ?? []
  )

  function cueDurationMs(cue: MotionSceneCue): number {
    const target = store.graph.getNode(cue.targetNodeId)
    const track = target?.motion?.tracks.find(({ id }) => id === cue.trackId)
    return track ? motionSceneTrackDurationMs(track) / (cue.timeScale ?? 1) : 0
  }

  function cueTargetName(cue: MotionSceneCue): string {
    return store.graph.getNode(cue.targetNodeId)?.name ?? cue.targetNodeId
  }

  function cueTrackName(cue: MotionSceneCue): string {
    const target = store.graph.getNode(cue.targetNodeId)
    return target?.motion?.tracks.find(({ id }) => id === cue.trackId)?.name ?? cue.trackId
  }

  const timelineDurationMs = computed(() => {
    const sequence = currentSequence.value
    const cueEnd = Math.max(
      0,
      ...(sequence?.cues.map((cue) => cue.startMs + cueDurationMs(cue)) ?? [])
    )
    const markerEnd = Math.max(0, ...(sequence?.markers?.map(({ timeMs }) => timeMs) ?? []))
    const extent = Math.max(
      MIN_TIMELINE_DURATION_MS,
      scenePlan.value?.durationMs ?? 0,
      cueEnd,
      markerEnd,
      playheadMs.value
    )
    return Math.min(MOTION_SCENE_LIMITS.timeMs.max, Math.ceil(extent / 100) * 100)
  })
  const tickStepMs = computed(() => niceTickStep(timelineDurationMs.value, zoom.value))
  const timelineTicks = computed(() => {
    const step = tickStepMs.value
    const ticks: number[] = []
    for (let time = 0; time <= timelineDurationMs.value; time += step) ticks.push(time)
    if (ticks.at(-1) !== timelineDurationMs.value) ticks.push(timelineDurationMs.value)
    return ticks
  })

  const canAddSequence = computed(() => sequences.value.length < MOTION_SCENE_LIMITS.maxSequences)
  const canRemoveSequence = computed(() => sequences.value.length > 1)
  const totalCueCount = computed(() =>
    sequences.value.reduce((total, sequence) => total + sequence.cues.length, 0)
  )
  const canAddCue = computed(
    () =>
      availableTracks.value.length > 0 &&
      (currentSequence.value?.cues.length ?? 0) < MOTION_SCENE_LIMITS.maxCuesPerSequence &&
      totalCueCount.value < MOTION_SCENE_LIMITS.maxTotalCues
  )
  const canRemoveCues = computed(() => selectedCueIds.value.size > 0)
  const canAddMarker = computed(
    () => (currentSequence.value?.markers?.length ?? 0) < MOTION_SCENE_LIMITS.maxMarkersPerSequence
  )
  function ownsPreview(context = previewContext.value): context is PreviewContext {
    if (!context) return false
    return store.state.motionPreview?.id === context.previewId
  }

  const previewVisible = computed(() => {
    const context = previewContext.value
    return Boolean(
      context &&
      context.ownerNodeId === ownerId.value &&
      context.sequenceId === selectedSequenceId.value &&
      ownsPreview(context)
    )
  })
  const previewPlaying = computed(() => previewVisible.value && store.isMotionPreviewActive())
  const visiblePlayheadMs = computed(() =>
    previewVisible.value
      ? (store.state.motionPreview?.elapsedMs ?? playheadMs.value)
      : playheadMs.value
  )

  function setAuthoringError(error: unknown): void {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }

  function commitScene(next: MotionSceneSpec, coalesceKey?: string): boolean {
    const sceneOwner = owner.value
    if (!sceneOwner || JSON.stringify(sceneOwner.motionScene) === JSON.stringify(next)) return false
    errorMessage.value = null
    return updateMotionSceneWithUndo(
      store,
      sceneOwner.id,
      next,
      panels.value.motionSceneUpdate,
      coalesceKey
    )
  }

  function withSceneEdit(edit: () => MotionSceneSpec, coalesceKey?: string): boolean {
    try {
      const changed = commitScene(edit(), coalesceKey)
      if (changed && ownsPreview()) seek(playheadMs.value, false)
      else if (changed) previewContext.value = null
      return changed
    } catch (error) {
      setAuthoringError(error)
      return false
    }
  }

  function selectSequence(sequenceId: string): void {
    if (!sequences.value.some(({ id }) => id === sequenceId)) return
    stopPreview()
    selectedSequenceId.value = sequenceId
    selectedCueIds.value = new Set()
    playheadMs.value = 0
    errorMessage.value = null
  }

  function createSequence(): void {
    if (!canAddSequence.value) return
    try {
      const result = addMotionSceneSequence(scene.value)
      if (!commitScene(result.scene)) return
      selectedSequenceId.value = result.sequenceId
      selectedCueIds.value = new Set()
      playheadMs.value = 0
    } catch (error) {
      setAuthoringError(error)
    }
  }

  function deleteSequence(): void {
    if (!currentSequence.value || !canRemoveSequence.value) return
    const currentIndex = sequences.value.findIndex(({ id }) => id === currentSequence.value?.id)
    const next = removeMotionSceneSequence(scene.value, currentSequence.value.id)
    const fallback = next.sequences.at(Math.min(currentIndex, next.sequences.length - 1))
    if (!fallback) return
    stopPreview()
    if (!commitScene(next)) return
    selectedSequenceId.value = fallback.id
    selectedCueIds.value = new Set()
    playheadMs.value = 0
  }

  function addCue(): void {
    const sequence = currentSequence.value
    const available = availableTracks.value.find(({ key }) => key === availableTrackKey.value)
    if (!sequence || !available || !canAddCue.value) return
    try {
      const startMs = snapEnabled.value
        ? snapMotionSceneTime(
            scene.value,
            sequence.id,
            playheadMs.value,
            snapGridMs.value,
            Math.max(1, snapGridMs.value / 5)
          )
        : playheadMs.value
      const result = addMotionSceneCue(scene.value, sequence.id, {
        targetNodeId: available.targetNodeId,
        trackId: available.trackId,
        startMs
      })
      if (!commitScene(result.scene)) return
      selectedCueIds.value = new Set([result.cueId])
    } catch (error) {
      setAuthoringError(error)
    }
  }

  function selectCue(cueId: string, additive = false): void {
    if (!currentSequence.value?.cues.some(({ id }) => id === cueId)) return
    if (!additive) {
      selectedCueIds.value = new Set([cueId])
      return
    }
    const next = new Set(selectedCueIds.value)
    if (next.has(cueId)) next.delete(cueId)
    else next.add(cueId)
    selectedCueIds.value = next
  }

  function selectAllCues(): void {
    const cueIds = currentSequence.value?.cues.map(({ id }) => id) ?? []
    selectedCueIds.value = selectedCueIds.value.size === cueIds.length ? new Set() : new Set(cueIds)
  }

  function deleteSelectedCues(): void {
    const sequence = currentSequence.value
    if (!sequence || !canRemoveCues.value) return
    const selected = new Set(selectedCueIds.value)
    if (withSceneEdit(() => removeMotionSceneCues(scene.value, sequence.id, selected))) {
      selectedCueIds.value = new Set()
    }
  }

  function setSelectedStartMs(value: string | number): void {
    const sequence = currentSequence.value
    if (!sequence || selectedCueIds.value.size === 0) return
    const startMs = bounded(
      finiteNumber(value, selectedStartMs.value ?? 0),
      MOTION_SCENE_LIMITS.timeMs.min,
      MOTION_SCENE_LIMITS.timeMs.max
    )
    withSceneEdit(() =>
      updateMotionSceneCues(scene.value, sequence.id, selectedCueIds.value, { startMs })
    )
  }

  function setSelectedTimeScale(value: string | number): void {
    const sequence = currentSequence.value
    if (!sequence || selectedCueIds.value.size === 0) return
    const timeScale = bounded(
      finiteNumber(value, selectedTimeScale.value ?? 1),
      MOTION_SCENE_LIMITS.timeScale.min,
      MOTION_SCENE_LIMITS.timeScale.max
    )
    withSceneEdit(() =>
      updateMotionSceneCues(scene.value, sequence.id, selectedCueIds.value, { timeScale })
    )
  }

  function setSelectedEnabled(enabled: boolean): void {
    const sequence = currentSequence.value
    if (!sequence || selectedCueIds.value.size === 0) return
    withSceneEdit(() =>
      updateMotionSceneCues(scene.value, sequence.id, selectedCueIds.value, { enabled })
    )
  }

  function toggleAutoKeyframe(enabled: boolean): void {
    autoKeyframeEnabled.value = enabled
  }

  function setAutoKeyframeValue(value: string | number): void {
    const sequence = currentSequence.value
    if (!autoKeyframeEnabled.value || !sequence || selectedCueIds.value.size === 0) return
    try {
      const changed = autoKeyframeMotionSceneCues(
        store,
        {
          scene: scene.value,
          sequenceId: sequence.id,
          cueIds: selectedCueIds.value,
          sceneTimeMs: playheadMs.value,
          channel: autoKeyframeChannel.value,
          value: finiteNumber(value, autoKeyframeValue.value ?? 0)
        },
        panels.value.motionAutoKeyframe
      )
      errorMessage.value = null
      if (changed > 0) seek(playheadMs.value, false)
    } catch (error) {
      setAuthoringError(error)
    }
  }

  function translateSelected(value: string | number, coalesceKey?: string): void {
    const sequence = currentSequence.value
    if (!sequence || selectedCueIds.value.size === 0) return
    const deltaMs = finiteNumber(value, 0)
    if (deltaMs === 0) return
    withSceneEdit(
      () =>
        translateMotionSceneCues(
          scene.value,
          sequence.id,
          selectedCueIds.value,
          deltaMs,
          snapEnabled.value
            ? {
                gridMs: snapGridMs.value,
                thresholdMs: Math.max(1, snapGridMs.value / 5)
              }
            : undefined
        ),
      coalesceKey
    )
  }

  function scaleSelected(value: string | number): void {
    const sequence = currentSequence.value
    if (!sequence || selectedCueIds.value.size === 0) return
    const factor = bounded(finiteNumber(value, 1), 0.01, 100)
    withSceneEdit(() =>
      scaleMotionSceneCues(scene.value, sequence.id, selectedCueIds.value, factor, playheadMs.value)
    )
  }

  function addMarker(): void {
    const sequence = currentSequence.value
    if (!sequence || !canAddMarker.value) return
    const count = (sequence.markers?.length ?? 0) + 1
    const result = addMotionSceneMarker(
      scene.value,
      sequence.id,
      playheadMs.value,
      panels.value.motionSceneMarkerDefault({ count: String(count) })
    )
    withSceneEdit(() => result.scene)
  }

  function deleteMarker(markerId: string): void {
    const sequence = currentSequence.value
    if (!sequence) return
    withSceneEdit(() => removeMotionSceneMarker(scene.value, sequence.id, markerId))
  }

  function setSnapGridMs(value: string | number): void {
    snapGridMs.value = bounded(
      finiteNumber(value, snapGridMs.value),
      1,
      MOTION_SCENE_LIMITS.timeMs.max
    )
  }

  function setZoom(value: string | number): void {
    zoom.value = bounded(finiteNumber(value, zoom.value), MIN_ZOOM, MAX_ZOOM)
  }

  function seek(value: string | number, applySnap = true): void {
    const sceneOwner = owner.value
    const sequence = currentSequence.value
    let timeMs = bounded(
      finiteNumber(value, playheadMs.value),
      MOTION_SCENE_LIMITS.timeMs.min,
      timelineDurationMs.value
    )
    if (applySnap && snapEnabled.value && sequence) {
      timeMs = snapMotionSceneTime(
        scene.value,
        sequence.id,
        timeMs,
        snapGridMs.value,
        Math.max(1, snapGridMs.value / 5)
      )
    }
    playheadMs.value = timeMs
    if (!sceneOwner?.motionScene || !sequence) {
      stopPreview()
      return
    }
    const result = store.seekMotionScenePreview(sceneOwner.id, sequence.id, timeMs, {
      infiniteAsSingleCycle: true,
      holdFinalFrame: true
    })
    previewContext.value =
      result.started && result.previewId !== undefined
        ? { ownerNodeId: sceneOwner.id, sequenceId: sequence.id, previewId: result.previewId }
        : null
  }

  function play(): void {
    const sceneOwner = owner.value
    const sequence = currentSequence.value
    if (!sceneOwner?.motionScene || !sequence) return
    playheadMs.value = 0
    const result = store.previewMotionScene(sceneOwner.id, sequence.id, {
      infiniteAsSingleCycle: true,
      holdFinalFrame: true
    })
    previewContext.value =
      result.started && result.previewId !== undefined
        ? { ownerNodeId: sceneOwner.id, sequenceId: sequence.id, previewId: result.previewId }
        : null
  }

  function stopPreview(): void {
    const context = previewContext.value
    if (ownsPreview(context)) {
      const elapsedMs = store.state.motionPreview?.elapsedMs
      if (elapsedMs !== undefined) {
        playheadMs.value = Math.min(timelineDurationMs.value, Math.max(0, elapsedMs))
      }
      store.stopMotionPreview(context.previewId)
    }
    previewContext.value = null
  }

  function cueHasIssue(cueId: string): boolean {
    return plannerIssues.value.some((issue) => issue.cueId === cueId)
  }

  watch(
    ownerId,
    () => {
      stopPreview()
      selectedSequenceId.value = scene.value.sequences[0]?.id ?? ''
      selectedCueIds.value = new Set()
      playheadMs.value = 0
      autoKeyframeEnabled.value = false
      errorMessage.value = null
    },
    { immediate: true }
  )
  watch(
    () => sequences.value.map(({ id }) => id).join('\u0000'),
    () => {
      if (!sequences.value.some(({ id }) => id === selectedSequenceId.value)) {
        selectedSequenceId.value = sequences.value[0]?.id ?? ''
      }
    }
  )
  watch(
    () => currentSequence.value?.cues.map(({ id }) => id).join('\u0000') ?? '',
    () => {
      const available = new Set<string>(currentSequence.value?.cues.map(({ id }) => id))
      selectedCueIds.value = new Set(
        [...selectedCueIds.value].filter((cueId) => available.has(cueId))
      )
    }
  )
  watch(
    () => availableTracks.value.map(({ key }) => key).join('\u0000'),
    () => {
      if (!availableTracks.value.some(({ key }) => key === availableTrackKey.value)) {
        availableTrackKey.value = availableTracks.value[0]?.key ?? ''
      }
    },
    { immediate: true }
  )
  watch(
    () => store.state.motionPreview?.elapsedMs,
    (elapsedMs) => {
      if (ownsPreview() && elapsedMs !== undefined) {
        playheadMs.value = Math.min(timelineDurationMs.value, Math.max(0, elapsedMs))
      }
    }
  )
  watch(
    () => store.state.motionPreview,
    (preview) => {
      const context = previewContext.value
      if (context && preview?.id !== context.previewId) previewContext.value = null
    }
  )
  watch(
    () =>
      [
        ownerId.value,
        selectedSequenceId.value,
        [...selectedCueIds.value].sort().join('\u0000'),
        visiblePlayheadMs.value,
        previewPlaying.value
      ] as const,
    () => {
      if (!ownerId.value) return
      const selected = selectedCues.value
      collab?.updateMotionTimelinePresence({
        scope: 'scene',
        ownerId: ownerId.value,
        ...(selectedSequenceId.value ? { sequenceId: selectedSequenceId.value } : {}),
        trackIds: [...new Set(selected.map(({ trackId }) => trackId))],
        keyframeIds: [],
        cueIds: [...selectedCueIds.value],
        playheadMs: visiblePlayheadMs.value,
        playing: previewPlaying.value
      })
    },
    { immediate: true }
  )
  if (componentInstance) {
    onBeforeUnmount(() => {
      stopPreview()
      collab?.updateMotionTimelinePresence(null)
    })
  }

  return {
    owner,
    hasAuthoredScene,
    scene,
    sequences,
    selectedSequenceId,
    currentSequence,
    availableTracks,
    availableTrackKey,
    selectedCueIds,
    selectedCues,
    selectedStartMs,
    selectedTimeScale,
    selectedEnabled,
    autoKeyframeEnabled,
    autoKeyframeChannel,
    autoKeyframeValue,
    plannerIssues,
    errorMessage,
    playheadMs,
    visiblePlayheadMs,
    timelineDurationMs,
    timelineTicks,
    zoom,
    snapEnabled,
    snapGridMs,
    previewVisible,
    previewPlaying,
    canAddSequence,
    canRemoveSequence,
    canAddCue,
    canRemoveCues,
    canAddMarker,
    cueDurationMs,
    cueTargetName,
    cueTrackName,
    cueHasIssue,
    selectSequence,
    createSequence,
    deleteSequence,
    addCue,
    selectCue,
    selectAllCues,
    deleteSelectedCues,
    setSelectedStartMs,
    setSelectedTimeScale,
    setSelectedEnabled,
    toggleAutoKeyframe,
    setAutoKeyframeValue,
    translateSelected,
    scaleSelected,
    addMarker,
    deleteMarker,
    setSnapGridMs,
    setZoom,
    seek,
    play,
    stopPreview
  }
}
