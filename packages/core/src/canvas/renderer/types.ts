import type { MotionVisualState } from '@open-pencil/motion'
import type { VectorRegion, VectorVertex } from '@open-pencil/scene-graph'
import type { Color, Rect, Vector } from '@open-pencil/scene-graph/primitives'
import type { SnapGuide } from '@open-pencil/scene-graph/snap'

import type { GuideOverlayState } from '#core/canvas/guides/types'
import type { MotionLayoutPreviewNode } from '#core/layout'
import type { TextEditor } from '#core/text/editor'

export interface RulerTheme {
  background: Color
  tick: Color
  text: Color
  label: Color
}

export type MeasurementMode = 'off' | 'shallow' | 'deep'

export interface RenderOverlays {
  /** Ephemeral scene-only motion deltas; absent from static render/export paths. */
  motionVisualStates?: ReadonlyMap<string, MotionVisualState>
  /** Non-persistent Yoga geometry derived from animated layout channels. */
  motionLayoutNodes?: ReadonlyMap<string, MotionLayoutPreviewNode>
  /** Exact injected timeline time. Undefined renders the authored static t=0 frame. */
  generatedEffectTimeMs?: number
  generatedEffectMode?: 'allow' | 'reduce' | 'disable'
  hoveredNodeId?: string | null
  measurementMode?: MeasurementMode
  enteredContainerId?: string | null
  editingTextId?: string | null
  textEditor?: TextEditor | null
  marquee?: Rect | null
  snapGuides?: SnapGuide[]
  guides?: GuideOverlayState
  rotationPreview?: { nodeId: string; angle: number } | null
  dropTargetId?: string | null
  layoutInsertIndicator?: {
    x: number
    y: number
    length: number
    direction: 'HORIZONTAL' | 'VERTICAL'
  } | null
  autoLayoutHover?: {
    nodeId: string
    kind: 'frame' | 'children' | 'spacing' | 'spacing-value' | 'padding' | 'padding-value'
    index?: number
    side?: 'top' | 'right' | 'bottom' | 'left'
  } | null
  penState?: {
    vertices: Vector[]
    segments: Array<{
      start: number
      end: number
      tangentStart: Vector
      tangentEnd: Vector
    }>
    dragTangent: Vector | null
    oppositeDragTangent?: Vector | null
    closingToFirst: boolean
    pendingClose?: boolean
    cursorX?: number
    cursorY?: number
  } | null
  nodeEditState?: {
    nodeId: string
    vertices: VectorVertex[]
    segments: Array<{
      start: number
      end: number
      tangentStart: Vector
      tangentEnd: Vector
    }>
    regions: VectorRegion[]
    selectedVertexIndices: Set<number>
    /** Set of selected handles as "segIdx:tangentField" strings */
    selectedHandles?: Set<string>
    hoveredHandleInfo?: { segmentIndex: number; tangentField: 'tangentStart' | 'tangentEnd' } | null
  } | null
  remoteCursors?: Array<{
    name: string
    color: Color
    x: number
    y: number
    selection?: string[]
  }>
}
