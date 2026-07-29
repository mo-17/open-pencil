import { computed, inject, provide, reactive, ref, type InjectionKey } from 'vue'

import { colorToCSS } from '@open-pencil/core/color'
import type { MotionScenePlanIssue } from '@open-pencil/core/motion'
import {
  MOTION_LIMITS,
  type MotionSceneCue,
  type MotionSceneMarker,
  type MotionSceneTrigger
} from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { useCollabInjected } from '@/app/collab/context'
import { MOTION_CHANNELS, type MotionChannel } from '@/app/properties/motion/timeline'
import { useMotionSceneTimelineEditor } from '@/app/properties/use-motion-scene-timeline-editor'

export const MOTION_SCENE_MIXED_NUMBER = Symbol('motion-scene-mixed-number')

function createMotionSceneTimelineView() {
  const { panels } = useI18n()
  const collab = useCollabInjected()
  const editor = useMotionSceneTimelineEditor()
  const translateDeltaMs = ref(100)
  const scaleFactor = ref(1)
  const autoKeyframeChannelLabels = computed<Record<MotionChannel, string>>(() => ({
    opacity: panels.value.motionChannelOpacity,
    x: panels.value.motionChannelX,
    y: panels.value.motionChannelY,
    scaleX: panels.value.motionChannelScaleX,
    scaleY: panels.value.motionChannelScaleY,
    rotate: panels.value.motionChannelRotate
  }))
  const autoKeyframeChannelOptions = computed(() =>
    MOTION_CHANNELS.map((channel) => ({
      value: channel,
      label: autoKeyframeChannelLabels.value[channel]
    }))
  )
  const autoKeyframeLimit = computed(() => {
    if (editor.autoKeyframeChannel.value === 'opacity') return MOTION_LIMITS.opacity
    if (
      editor.autoKeyframeChannel.value === 'scaleX' ||
      editor.autoKeyframeChannel.value === 'scaleY'
    ) {
      return MOTION_LIMITS.scale
    }
    if (editor.autoKeyframeChannel.value === 'rotate') return MOTION_LIMITS.rotate
    return MOTION_LIMITS.translate
  })
  const autoKeyframeStep = computed(() => {
    if (editor.autoKeyframeChannel.value === 'opacity') return 0.05
    if (
      editor.autoKeyframeChannel.value === 'scaleX' ||
      editor.autoKeyframeChannel.value === 'scaleY'
    ) {
      return 0.1
    }
    return 1
  })
  const sequenceTriggerLabels = computed<Record<MotionSceneTrigger, string>>(() => ({
    pageEnter: panels.value.motionSceneTriggerPageEnter,
    pageExit: panels.value.motionSceneTriggerPageExit,
    manual: panels.value.motionSceneTriggerManual
  }))
  const sequenceOptions = computed(() =>
    editor.sequences.value.map((sequence) => ({
      value: sequence.id,
      label: `${sequence.name ?? sequence.id} · ${sequenceTriggerLabels.value[sequence.trigger]}`
    }))
  )
  const availableTrackOptions = computed(() =>
    editor.availableTracks.value.map((track) => ({
      value: track.key,
      label: `${track.targetName} · ${track.trackName}`
    }))
  )
  const ownerKind = computed(() =>
    editor.owner.value?.type === 'FRAME'
      ? panels.value.motionSceneFrame
      : panels.value.motionScenePage
  )
  const timelineContentStyle = computed(() => ({
    width: `${Math.round(editor.zoom.value * 100)}%`,
    minWidth: '100%'
  }))
  const playheadStyle = computed(() => ({
    left: timePosition(editor.visiblePlayheadMs.value)
  }))
  const remoteTimelinePeers = computed(
    () =>
      collab?.remotePeers.value.filter(
        (peer) =>
          peer.motionTimeline?.scope === 'scene' &&
          peer.motionTimeline.ownerId === editor.owner.value?.id &&
          peer.motionTimeline.sequenceId === editor.selectedSequenceId.value
      ) ?? []
  )
  const allCuesSelected = computed(
    () =>
      (editor.currentSequence.value?.cues.length ?? 0) > 0 &&
      editor.selectedCueIds.value.size === editor.currentSequence.value?.cues.length
  )

  let cueDragSequence = 0
  let cueDrag: CueDrag | undefined

  function timePosition(timeMs: number): string {
    const duration = editor.timelineDurationMs.value
    return `${Math.min(100, Math.max(0, (timeMs / duration) * 100))}%`
  }

  function cueStyle(cue: MotionSceneCue): Record<string, string> {
    const width = Math.max(1.5, (editor.cueDurationMs(cue) / editor.timelineDurationMs.value) * 100)
    return {
      left: timePosition(cue.startMs),
      width: `${Math.min(100, width)}%`
    }
  }

  function markerStyle(marker: MotionSceneMarker): Record<string, string> {
    return { left: timePosition(marker.timeMs) }
  }

  function remotePlayheadStyle(peer: (typeof remoteTimelinePeers.value)[number]) {
    return {
      left: timePosition(peer.motionTimeline?.playheadMs ?? 0),
      background: colorToCSS(peer.color)
    }
  }

  function formatTime(timeMs: number): string {
    return timeMs >= 1_000
      ? `${(timeMs / 1_000).toFixed(timeMs % 1_000 === 0 ? 0 : 1)}s`
      : `${Math.round(timeMs)}ms`
  }

  function seekFromTimeline(event: PointerEvent): void {
    if (event.button !== 0) return
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    editor.seek(ratio * editor.timelineDurationMs.value)
  }

  function beginCueDrag(event: PointerEvent, cue: MotionSceneCue): void {
    if (event.button !== 0) return
    const additive = event.metaKey || event.ctrlKey
    if (additive) {
      editor.selectCue(cue.id, true)
      if (!editor.selectedCueIds.value.has(cue.id)) return
    } else if (!editor.selectedCueIds.value.has(cue.id)) {
      editor.selectCue(cue.id)
    }
    const button = event.currentTarget as HTMLButtonElement
    const content = button.closest<HTMLElement>('[data-scene-timeline-content]')
    if (!content) return
    const rect = content.getBoundingClientRect()
    if (rect.width <= 0) return
    cueDrag = {
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      width: rect.width,
      coalesceKey: `motion-scene-cue-drag:${editor.selectedSequenceId.value}:${++cueDragSequence}`
    }
    button.setPointerCapture(event.pointerId)
  }

  function moveCueDrag(event: PointerEvent): void {
    const drag = cueDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.lastClientX
    if (Math.abs(deltaX) < 1) return
    drag.lastClientX = event.clientX
    editor.translateSelected(
      (deltaX / drag.width) * editor.timelineDurationMs.value,
      drag.coalesceKey
    )
  }

  function finishCueDrag(event: PointerEvent): void {
    const drag = cueDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    const button = event.currentTarget as HTMLButtonElement
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId)
    cueDrag = undefined
  }

  function nudgeCue(cue: MotionSceneCue, direction: -1 | 1, event: KeyboardEvent): void {
    if (!editor.selectedCueIds.value.has(cue.id)) editor.selectCue(cue.id)
    let step = editor.snapGridMs.value
    if (!editor.snapEnabled.value) step = event.shiftKey ? 100 : 10
    editor.translateSelected(direction * step)
  }

  function removeCueFromKeyboard(cue: MotionSceneCue): void {
    if (!editor.selectedCueIds.value.has(cue.id)) editor.selectCue(cue.id)
    editor.deleteSelectedCues()
  }

  function issueLabel(issue: MotionScenePlanIssue): string {
    const labels: Record<MotionScenePlanIssue['code'], string> = {
      'duplicate-cue-target': panels.value.motionSceneIssueDuplicate,
      'motion-missing': panels.value.motionSceneIssueMotionMissing,
      'target-missing': panels.value.motionSceneIssueTargetMissing,
      'track-missing': panels.value.motionSceneIssueTrackMissing
    }
    return `${labels[issue.code]} · ${issue.targetNodeId}/${issue.trackId}`
  }

  function onPlayheadInput(event: Event): void {
    editor.seek(Number((event.target as HTMLInputElement).value), false)
  }

  function onZoomInput(event: Event): void {
    editor.setZoom(Number((event.target as HTMLInputElement).value))
  }

  return reactive({
    ...editor,
    panels,
    translateDeltaMs,
    scaleFactor,
    autoKeyframeChannelLabels,
    autoKeyframeChannelOptions,
    autoKeyframeLimit,
    autoKeyframeStep,
    sequenceOptions,
    availableTrackOptions,
    ownerKind,
    timelineContentStyle,
    playheadStyle,
    remoteTimelinePeers,
    allCuesSelected,
    timePosition,
    cueStyle,
    markerStyle,
    remotePlayheadStyle,
    formatTime,
    seekFromTimeline,
    beginCueDrag,
    moveCueDrag,
    finishCueDrag,
    nudgeCue,
    removeCueFromKeyboard,
    issueLabel,
    onPlayheadInput,
    onZoomInput
  })
}

interface CueDrag {
  pointerId: number
  lastClientX: number
  width: number
  coalesceKey: string
}

export type MotionSceneTimelineView = ReturnType<typeof createMotionSceneTimelineView>

const MOTION_SCENE_TIMELINE_VIEW: InjectionKey<MotionSceneTimelineView> = Symbol(
  'motion-scene-timeline-view'
)

export function provideMotionSceneTimelineView(): MotionSceneTimelineView {
  const view = createMotionSceneTimelineView()
  provide(MOTION_SCENE_TIMELINE_VIEW, view)
  return view
}

export function useMotionSceneTimelineView(): MotionSceneTimelineView {
  const view = inject(MOTION_SCENE_TIMELINE_VIEW)
  if (!view) throw new Error('Motion scene timeline view was not provided')
  return view
}
