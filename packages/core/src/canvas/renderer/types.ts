import type { MotionVisualState } from '@open-pencil/motion'
import type { VectorRegion, VectorVertex } from '@open-pencil/scene-graph'
import type { Color, Rect, Vector } from '@open-pencil/scene-graph/primitives'
import type { SnapGuide } from '@open-pencil/scene-graph/snap'

import type { GuideOverlayState } from '#core/canvas/guides/types'
import type { DesignIssueOverlay } from '#core/canvas/issues/types'
import type { RotationPreview } from '#core/geometry'
import type { MotionLayoutPreviewNode } from '#core/layout'
import type { TabsTabPreview } from '#core/plugins/content/tabs-preview'
import type { TextEditor } from '#core/text/editor'

export interface RulerTheme {
  background: Color
  tick: Color
  text: Color
  label: Color
}

export type MeasurementMode = 'off' | 'shallow' | 'deep'

/** Where a collaborator or an agent is working, in world coordinates. */
export interface PresenceCursor {
  kind: 'person' | 'agent'
  name: string
  /** A person's color, or the color of the person who runs the agent. */
  color: Color
  x: number
  y: number
  selection?: string[]
}

export interface RenderOverlays {
  /** View-local Tabs choice, omitted from static exports. */
  tabsPreview?: TabsTabPreview | null
  /** Editor-only subtree view; never included in static export. */
  contentRootId?: string
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
  rotationPreview?: RotationPreview | null
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
    selectedHandles?: Set<number>
    hoveredHandleInfo?: { segmentIndex: number; tangentField: 'tangentStart' | 'tangentEnd' } | null
  } | null
  presenceCursors?: PresenceCursor[]
  designIssues?: DesignIssueOverlay | null
  codeFocusNodeId?: string | null
}
