import {
  Align,
  Direction,
  Display,
  FlexDirection,
  Gutter,
  Edge,
  MeasureMode,
  Overflow,
  Wrap,
  type Node as YogaNode
} from 'yoga-layout'

import { applyYogaLayoutSteps, type LayoutApplyStep } from './layout/apply'
import { usesDetachedDerivedLayout } from './layout/derived'
import { applyEffectiveGeneratedTextLayout } from './layout/effective-generated-text'
import type { LayoutGraph } from './layout/graph'
import { buildGridTreeSteps, createGridChildNode } from './layout/grid'
import { resolveNodeLayoutDirection } from './text/direction'
export {
  estimateTextSize,
  getTextMeasurer,
  setTextMeasurer,
  type TextMeasurer
} from './layout/text-measurement'
import { isAutoLayoutMode, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { throwIfAborted, yieldToHost } from '#core/async-work'

import { estimateTextSize, getTextMeasurer } from './layout/text-measurement'
import {
  applyMinMaxConstraints,
  configureAbsoluteChild,
  createYogaNode,
  freeYogaTree,
  mapAlign,
  mapAlignSelf,
  mapGridTrack,
  mapJustify
} from './layout/yoga-helpers'

const LAYOUT_ABORT_MESSAGE = 'Layout cancelled'
import type { MotionVisualState } from './motion'

export type LayoutWorkPriority = 'interactive' | 'normal' | 'idle'

export const LAYOUT_TIME_SLICE_MS = {
  interactive: 2,
  normal: 5,
  idle: 8
} as const satisfies Record<LayoutWorkPriority, number>

let defaultLayoutTimeSliceMs: number = LAYOUT_TIME_SLICE_MS.normal

export interface ComputeAllLayoutsAsyncOptions {
  signal?: AbortSignal
  priority?: LayoutWorkPriority
  /** A getter allows a running background layout to follow a changed resource profile. */
  timeSliceMs?: number | (() => number)
  /** Injectable monotonic clock for hosts and deterministic tests. */
  now?: () => number
  /** Injectable task yield. Abort is checked immediately before and after it. */
  hostYield?: (signal?: AbortSignal) => Promise<void>
}

interface LayoutCooperativeExecution {
  signal?: AbortSignal
  timeSliceMs: () => number
  now: () => number
  hostYield: (signal?: AbortSignal) => Promise<void>
  sliceStartedAt: number
}

export function layoutTimeSliceMsForPriority(priority: LayoutWorkPriority): number {
  return LAYOUT_TIME_SLICE_MS[priority]
}

/** Changes the default for pending and running cooperative layouts without affecting sync Yoga. */
export function setDefaultLayoutTimeSliceMs(timeSliceMs: number): void {
  defaultLayoutTimeSliceMs = normalizedTimeSliceMs(timeSliceMs)
}

export function getDefaultLayoutTimeSliceMs(): number {
  return defaultLayoutTimeSliceMs
}

export function computeLayout(graph: LayoutGraph, frameId: string): void {
  const steps = computeLayoutSteps(graph, frameId)
  let state = steps.next()
  while (!state.done) state = steps.next()
}

type LayoutStep = LayoutApplyStep
type LayoutSteps<T = void> = Generator<LayoutStep, T, void>

function* computeLayoutSteps(graph: LayoutGraph, frameId: string): LayoutSteps {
  const frame = graph.getNode(frameId)
  if (!frame || !isAutoLayoutMode(frame.layoutMode)) return

  const rootDirection = resolveComputedLayoutDirection(graph, frame)
  const yogaRoot = yield* asLayoutSteps(
    frame.layoutMode === 'GRID'
      ? buildGridTreeSteps(graph, frame, rootDirection)
      : buildYogaTreeSteps(graph, frame, rootDirection)
  )
  try {
    // Yoga's WASM calculate call is synchronous and must remain atomic. These
    // markers let the async runner yield immediately before and after it.
    yield 'atomic'
    yogaRoot.calculateLayout(
      undefined,
      undefined,
      rootDirection === 'RTL' ? Direction.RTL : Direction.LTR
    )
    yield 'atomic'
    yield* applyYogaLayoutSteps(graph, frame, yogaRoot, computeLayoutSteps)
    yield 'atomic'
  } finally {
    freeYogaTree(yogaRoot)
  }
}

function* asLayoutSteps<T>(steps: Generator<void, T, void>): LayoutSteps<T> {
  let completed = false
  try {
    let state = steps.next()
    while (!state.done) {
      yield 'work'
      state = steps.next()
    }
    completed = true
    return state.value
  } finally {
    if (!completed) steps.return(undefined as T)
  }
}
function resolveComputedLayoutDirection(
  graph: LayoutGraph,
  node: Pick<SceneNode, 'layoutDirection' | 'parentId'>
): 'LTR' | 'RTL' {
  const parent = node.parentId ? graph.getNode(node.parentId) : null
  const inheritedDirection = parent ? resolveComputedLayoutDirection(graph, parent) : 'LTR'
  return resolveNodeLayoutDirection(node, inheritedDirection)
}

export function computeAllLayouts(graph: SceneGraph, scopeId?: string): void {
  const rootId = scopeId ?? graph.rootId
  const visited = new Set<string>()
  computeLayoutsBottomUp(graph, rootId, visited)
  if (applyEffectiveGeneratedTextLayout(graph, rootId)) {
    computeLayoutsBottomUp(graph, rootId, new Set())
  }
}

/**
 * Cooperative variant for long-running AI/automation work. It yields between
 * bounded traversal/layout time slices so WebKit can deliver AbortSignal events.
 * The former fourth marker-count argument remains accepted for source
 * compatibility but no longer controls scheduling.
 */
export async function computeAllLayoutsAsync(
  graph: SceneGraph,
  scopeId?: string,
  signalOrOptions?: AbortSignal | ComputeAllLayoutsAsyncOptions,
  _legacyYieldEvery?: number
): Promise<void> {
  const options = asComputeAllLayoutsAsyncOptions(signalOrOptions)
  const signal = options.signal
  const execution = createLayoutCooperativeExecution(options)
  throwIfAborted(signal, LAYOUT_ABORT_MESSAGE)
  const rootId = scopeId ?? graph.rootId
  await computeAllLayoutsPassAsync(graph, rootId, execution)
  throwIfAborted(signal, LAYOUT_ABORT_MESSAGE)
  if (applyEffectiveGeneratedTextLayout(graph, rootId)) {
    await computeAllLayoutsPassAsync(graph, rootId, execution)
  }
  throwIfAborted(signal, LAYOUT_ABORT_MESSAGE)
}

async function computeAllLayoutsPassAsync(
  graph: SceneGraph,
  rootId: string,
  execution: LayoutCooperativeExecution
): Promise<void> {
  const visited = new Set<string>()
  const pending: Array<{ nodeId: string; coveredByParentLayout: boolean }> = [
    { nodeId: rootId, coveredByParentLayout: false }
  ]
  const layoutRoots: string[] = []

  while (pending.length > 0) {
    const next = pending.pop()
    if (!next || visited.has(next.nodeId)) continue
    const { nodeId, coveredByParentLayout } = next
    const node = graph.getNode(nodeId)
    if (!node) continue
    visited.add(nodeId)
    const participatesInLayout =
      isAutoLayoutMode(node.layoutMode) && !preservesImportedInstanceLayout(node)
    if (participatesInLayout && !coveredByParentLayout) layoutRoots.push(nodeId)

    for (const childId of node.childIds) {
      const child = graph.getNode(childId)
      const childCovered =
        participatesInLayout &&
        !!child &&
        isAutoLayoutMode(child.layoutMode) &&
        !preservesImportedInstanceLayout(child) &&
        child.visible &&
        child.layoutPositioning !== 'ABSOLUTE'
      pending.push({ nodeId: childId, coveredByParentLayout: childCovered })
    }
    await checkpointLayout(execution)
  }

  // One Yoga tree already contains every contiguous visible flow-layout
  // descendant. Computing only the uncovered roots avoids the prior quadratic
  // pattern where each nested frame was calculated once by itself and again
  // through every ancestor.
  for (const nodeId of layoutRoots) {
    await computeLayoutCooperatively(graph, nodeId, execution)
    await checkpointLayout(execution)
  }
}

async function computeLayoutCooperatively(
  graph: LayoutGraph,
  frameId: string,
  execution: LayoutCooperativeExecution
): Promise<void> {
  const steps = computeLayoutSteps(graph, frameId)
  let completed = false
  try {
    let state = steps.next()
    while (!state.done) {
      await checkpointLayout(execution, state.value === 'atomic')
      state = steps.next()
    }
    completed = true
  } finally {
    // Closing a suspended generator runs the Yoga-tree finally blocks and
    // frees every partially-built WASM node after cancellation or failure.
    if (!completed) steps.return(undefined)
  }
}

async function checkpointLayout(
  execution: LayoutCooperativeExecution,
  force = false
): Promise<void> {
  throwIfAborted(execution.signal, LAYOUT_ABORT_MESSAGE)
  const elapsed = execution.now() - execution.sliceStartedAt
  if (!force && elapsed < execution.timeSliceMs()) return
  await execution.hostYield(execution.signal)
  throwIfAborted(execution.signal, LAYOUT_ABORT_MESSAGE)
  execution.sliceStartedAt = execution.now()
}

function asComputeAllLayoutsAsyncOptions(
  value: AbortSignal | ComputeAllLayoutsAsyncOptions | undefined
): ComputeAllLayoutsAsyncOptions {
  if (!value) return {}
  return isAbortSignal(value) ? { signal: value } : value
}

function isAbortSignal(value: AbortSignal | ComputeAllLayoutsAsyncOptions): value is AbortSignal {
  return (
    'aborted' in value &&
    typeof value.addEventListener === 'function' &&
    typeof value.removeEventListener === 'function'
  )
}

function createLayoutCooperativeExecution(
  options: ComputeAllLayoutsAsyncOptions
): LayoutCooperativeExecution {
  const configuredTimeSlice =
    options.timeSliceMs ??
    (options.priority
      ? layoutTimeSliceMsForPriority(options.priority)
      : () => getDefaultLayoutTimeSliceMs())
  const timeSliceMs =
    typeof configuredTimeSlice === 'function'
      ? () => normalizedTimeSliceMs(configuredTimeSlice())
      : () => normalizedTimeSliceMs(configuredTimeSlice)
  const now = options.now ?? monotonicNow
  return {
    signal: options.signal,
    timeSliceMs,
    now,
    hostYield: options.hostYield ?? ((signal) => yieldToHost(signal, LAYOUT_ABORT_MESSAGE)),
    sliceStartedAt: now()
  }
}

function normalizedTimeSliceMs(timeSliceMs: number): number {
  if (!Number.isFinite(timeSliceMs) || timeSliceMs < 0) {
    throw new RangeError('Layout time slice must be a finite non-negative number')
  }
  return timeSliceMs
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export type MotionLayoutPreviewNode = Pick<SceneNode, 'x' | 'y' | 'width' | 'height'>

/**
 * Compute the ephemeral Yoga geometry needed by MotionSpec layout channels.
 * The authored SceneGraph is never mutated: writes are captured by a small
 * copy-on-write graph facade and only the resulting geometry is returned.
 */
export function computeMotionLayoutPreview(
  graph: SceneGraph,
  visuals: ReadonlyMap<string, MotionVisualState> | undefined
): ReadonlyMap<string, MotionLayoutPreviewNode> {
  if (!visuals || visuals.size === 0) return new Map()

  const preview = new MotionLayoutPreviewGraph(graph)
  const roots = new Set<string>()
  for (const [nodeId, visual] of visuals) {
    if (!hasMotionLayoutGeometry(visual)) continue
    const node = graph.getNode(nodeId)
    if (!node) continue
    preview.project(node, visual)
    const root = motionLayoutRoot(graph, node)
    if (root) roots.add(root.id)
  }
  if (roots.size === 0) return new Map()

  for (const rootId of roots) preview.clearDerivedLayout(rootId)
  for (const rootId of roots) computeLayout(preview, rootId)
  return preview.geometry()
}

function hasMotionLayoutGeometry(visual: MotionVisualState): boolean {
  return (
    visual.width !== undefined ||
    visual.height !== undefined ||
    visual.gap !== undefined ||
    visual.rowGap !== undefined ||
    visual.columnGap !== undefined ||
    visual.paddingTop !== undefined ||
    visual.paddingRight !== undefined ||
    visual.paddingBottom !== undefined ||
    visual.paddingLeft !== undefined
  )
}

function motionLayoutRoot(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode | undefined
  if (isAutoLayoutMode(node.layoutMode)) current = node
  else if (node.layoutPositioning !== 'ABSOLUTE' && node.parentId) {
    current = graph.getNode(node.parentId)
  }
  if (!current || !isAutoLayoutMode(current.layoutMode)) return undefined

  while (current.parentId && current.layoutPositioning !== 'ABSOLUTE') {
    const parent = graph.getNode(current.parentId)
    if (!parent || !isAutoLayoutMode(parent.layoutMode)) break
    current = parent
  }
  return current
}

class MotionLayoutPreviewGraph {
  private readonly changed = new Map<string, SceneNode>()

  constructor(private readonly source: SceneGraph) {}

  getNode(id: string): SceneNode | undefined {
    return this.changed.get(id) ?? this.source.getNode(id)
  }

  getChildren(id: string): SceneNode[] {
    const node = this.getNode(id)
    return node ? node.childIds.flatMap((childId) => this.getNode(childId) ?? []) : []
  }

  updateNode(id: string, changes: Partial<SceneNode>): void {
    const node = this.mutable(id)
    if (node) Object.assign(node, changes)
  }

  project(node: SceneNode, visual: MotionVisualState): void {
    const projected = this.mutable(node.id)
    if (!projected) return
    projectMotionDimensions(projected, visual, this.parentOf(projected))
    projectMotionTextResize(projected, visual)
    projectMotionGaps(projected, visual)
    projectMotionPadding(projected, visual)
  }

  clearDerivedLayout(rootId: string): void {
    const stack = [rootId]
    while (stack.length > 0) {
      const nodeId = stack.pop()
      if (!nodeId) continue
      const node = this.mutable(nodeId)
      if (!node) continue
      node.figmaDerivedLayout = null
      if (node.type === 'INSTANCE' && node.source.format === 'fig' && nodeId !== rootId) continue
      stack.push(...node.childIds)
    }
  }

  geometry(): ReadonlyMap<string, MotionLayoutPreviewNode> {
    const result = new Map<string, MotionLayoutPreviewNode>()
    for (const [id, node] of this.changed) {
      const source = this.source.getNode(id)
      if (
        !source ||
        (node.x === source.x &&
          node.y === source.y &&
          node.width === source.width &&
          node.height === source.height)
      ) {
        continue
      }
      result.set(id, { x: node.x, y: node.y, width: node.width, height: node.height })
    }
    return result
  }

  private mutable(id: string): SceneNode | undefined {
    const existing = this.changed.get(id)
    if (existing) return existing
    const source = this.source.getNode(id)
    if (!source) return undefined
    const clone = { ...source }
    this.changed.set(id, clone)
    return clone
  }

  private parentOf(node: SceneNode): SceneNode | undefined {
    return node.parentId ? this.getNode(node.parentId) : undefined
  }
}

function projectMotionDimensions(
  node: SceneNode,
  visual: MotionVisualState,
  parent: SceneNode | undefined
): void {
  if (visual.width !== undefined) {
    node.width = visual.width
    fixAnimatedAxis(node, 'width', parent)
  }
  if (visual.height !== undefined) {
    node.height = visual.height
    fixAnimatedAxis(node, 'height', parent)
  }
}

function projectMotionTextResize(node: SceneNode, visual: MotionVisualState): void {
  if (node.type !== 'TEXT') return
  if (visual.height !== undefined) node.textAutoResize = 'NONE'
  else if (visual.width !== undefined && node.textAutoResize === 'WIDTH_AND_HEIGHT') {
    node.textAutoResize = 'HEIGHT'
  }
}

function projectMotionGaps(node: SceneNode, visual: MotionVisualState): void {
  if (node.layoutMode === 'GRID') {
    node.gridRowGap = visual.rowGap ?? visual.gap ?? node.gridRowGap
    node.gridColumnGap = visual.columnGap ?? visual.gap ?? node.gridColumnGap
    return
  }
  const mainGap = node.layoutMode === 'HORIZONTAL' ? visual.columnGap : visual.rowGap
  const crossGap = node.layoutMode === 'HORIZONTAL' ? visual.rowGap : visual.columnGap
  node.itemSpacing = mainGap ?? visual.gap ?? node.itemSpacing
  node.counterAxisSpacing = crossGap ?? visual.gap ?? node.counterAxisSpacing
}

function projectMotionPadding(node: SceneNode, visual: MotionVisualState): void {
  if (visual.paddingTop !== undefined) node.paddingTop = visual.paddingTop
  if (visual.paddingRight !== undefined) node.paddingRight = visual.paddingRight
  if (visual.paddingBottom !== undefined) node.paddingBottom = visual.paddingBottom
  if (visual.paddingLeft !== undefined) node.paddingLeft = visual.paddingLeft
}

function fixAnimatedAxis(
  node: SceneNode,
  axis: 'width' | 'height',
  parent: SceneNode | undefined
): void {
  if (isAutoLayoutMode(node.layoutMode) && node.layoutMode !== 'GRID') {
    const isPrimary =
      (node.layoutMode === 'HORIZONTAL' && axis === 'width') ||
      (node.layoutMode === 'VERTICAL' && axis === 'height')
    if (isPrimary) node.primaryAxisSizing = 'FIXED'
    else node.counterAxisSizing = 'FIXED'
  }
  if (!parent || !isAutoLayoutMode(parent.layoutMode)) return
  const isParentMain =
    parent.layoutMode === 'GRID' ||
    (parent.layoutMode === 'HORIZONTAL' && axis === 'width') ||
    (parent.layoutMode === 'VERTICAL' && axis === 'height')
  if (isParentMain) node.layoutGrow = 0
  if (parent.layoutMode === 'GRID' || !isParentMain) node.layoutAlignSelf = 'MIN'
}

function computeLayoutsBottomUp(graph: SceneGraph, nodeId: string, visited: Set<string>): void {
  const node = graph.getNode(nodeId)
  if (!node || visited.has(nodeId)) return
  visited.add(nodeId)

  for (const childId of node.childIds) {
    computeLayoutsBottomUp(graph, childId, visited)
  }

  if (isAutoLayoutMode(node.layoutMode) && !preservesImportedInstanceLayout(node)) {
    computeLayout(graph, nodeId)
  }
}

function preservesImportedInstanceLayout(node: SceneNode): boolean {
  return node.type === 'INSTANCE' && node.source.format === 'fig'
}

// --- Flex layout ---

function* buildYogaTreeSteps(
  graph: LayoutGraph,
  frame: SceneNode,
  inheritedDirection: 'LTR' | 'RTL'
): Generator<void, YogaNode, void> {
  const root = createYogaNode()
  let completed = false
  try {
    const direction = resolveNodeLayoutDirection(frame, inheritedDirection)

    if (frame.primaryAxisSizing === 'FIXED') {
      if (frame.layoutMode === 'HORIZONTAL') root.setWidth(frame.width)
      else root.setHeight(frame.height)
    }
    if (frame.counterAxisSizing === 'FIXED') {
      if (frame.layoutMode === 'HORIZONTAL') root.setHeight(frame.height)
      else root.setWidth(frame.width)
    }

    configureFlexContainer(root, frame, direction)

    const children = graph.getChildren(frame.id)
    for (const child of children) {
      yield
      const yogaChild = createYogaNode()
      // Attach first so aborting a nested builder still lets root cleanup own
      // every allocated Yoga node.
      root.insertChild(yogaChild, root.getChildCount())

      if (child.layoutPositioning === 'ABSOLUTE') {
        configureAbsoluteChild(yogaChild, child)
      } else if (!child.visible) {
        yogaChild.setDisplay(Display.None)
      } else if (child.layoutMode === 'GRID') {
        yield* configureChildAsGridSteps(yogaChild, child, frame, graph, direction)
      } else if (isAutoLayoutMode(child.layoutMode)) {
        yield* configureChildAsAutoLayoutSteps(yogaChild, child, frame, graph, direction)
      } else {
        configureChildAsLeaf(yogaChild, child, frame, graph)
      }
    }

    completed = true
    return root
  } finally {
    if (!completed) freeYogaTree(root)
  }
}

function configureFlexContainer(
  yogaNode: YogaNode,
  node: SceneNode,
  direction: Exclude<SceneNode['layoutDirection'], 'AUTO'>
): void {
  yogaNode.setDirection(direction === 'RTL' ? Direction.RTL : Direction.LTR)
  yogaNode.setFlexDirection(
    node.layoutMode === 'HORIZONTAL' ? FlexDirection.Row : FlexDirection.Column
  )
  yogaNode.setFlexWrap(node.layoutWrap === 'WRAP' ? Wrap.Wrap : Wrap.NoWrap)
  yogaNode.setJustifyContent(mapJustify(node.primaryAxisAlign))
  yogaNode.setAlignItems(mapAlign(node.counterAxisAlign))
  if (node.clipsContent) yogaNode.setOverflow(Overflow.Hidden)

  if (node.layoutWrap === 'WRAP' && node.counterAxisAlignContent === 'SPACE_BETWEEN') {
    yogaNode.setAlignContent(Align.SpaceBetween)
  }

  yogaNode.setPadding(Edge.Top, node.paddingTop)
  yogaNode.setPadding(Edge.Right, node.paddingRight)
  yogaNode.setPadding(Edge.Bottom, node.paddingBottom)
  yogaNode.setPadding(Edge.Left, node.paddingLeft)

  const primaryGap = node.primaryAxisAlign === 'SPACE_BETWEEN' ? 0 : node.itemSpacing
  yogaNode.setGap(
    Gutter.Column,
    node.layoutMode === 'HORIZONTAL' ? primaryGap : node.counterAxisSpacing
  )
  yogaNode.setGap(
    Gutter.Row,
    node.layoutMode === 'HORIZONTAL' ? node.counterAxisSpacing : primaryGap
  )

  applyMinMaxConstraints(yogaNode, node)
}

function* configureChildAsGridSteps(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: LayoutGraph,
  inheritedDirection: 'LTR' | 'RTL'
): Generator<void, void, void> {
  const direction = resolveNodeLayoutDirection(child, inheritedDirection)
  yogaChild.setDisplay(Display.Grid)
  yogaChild.setDirection(direction === 'RTL' ? Direction.RTL : Direction.LTR)

  if (child.gridTemplateColumns.length > 0) {
    yogaChild.setGridTemplateColumns(child.gridTemplateColumns.map(mapGridTrack))
  }
  if (child.gridTemplateRows.length > 0) {
    yogaChild.setGridTemplateRows(child.gridTemplateRows.map(mapGridTrack))
  }

  yogaChild.setGap(Gutter.Column, child.gridColumnGap)
  yogaChild.setGap(Gutter.Row, child.gridRowGap)

  yogaChild.setPadding(Edge.Top, child.paddingTop)
  yogaChild.setPadding(Edge.Right, child.paddingRight)
  yogaChild.setPadding(Edge.Bottom, child.paddingBottom)
  yogaChild.setPadding(Edge.Left, child.paddingLeft)

  const isParentRow = parent.layoutMode === 'HORIZONTAL'
  const selfOverride = child.layoutAlignSelf !== 'AUTO'
  const stretchCross = selfOverride
    ? child.layoutAlignSelf === 'STRETCH'
    : parent.counterAxisAlign === 'STRETCH'

  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow)
    yogaChild.setFlexShrink(1)
    yogaChild.setFlexBasis(0)
    if (!stretchCross) {
      if (isParentRow) yogaChild.setHeight(child.height)
      else yogaChild.setWidth(child.width)
    }
  } else {
    if (isParentRow) {
      yogaChild.setWidth(child.width)
      if (!stretchCross) yogaChild.setHeight(child.height)
    } else {
      if (child.gridTemplateRows.length > 0) yogaChild.setHeight(child.height)
      if (!stretchCross) yogaChild.setWidth(child.width)
    }
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  applyMinMaxConstraints(yogaChild, child)

  const grandchildren = graph.getChildren(child.id)
  for (const gc of grandchildren) {
    yield
    if (gc.layoutPositioning === 'ABSOLUTE') {
      const yogaGC = createYogaNode()
      yogaChild.insertChild(yogaGC, yogaChild.getChildCount())
      configureAbsoluteChild(yogaGC, gc)
    } else {
      yogaChild.insertChild(createGridChildNode(gc), yogaChild.getChildCount())
    }
  }
}

type AxisSizing = SceneNode['primaryAxisSizing']
function sizesFitParent(
  parent: SceneNode,
  childCount: number,
  sizes: Array<number | undefined>,
  axis: 'width' | 'height'
): boolean {
  if (sizes.some((size) => size === undefined)) return false
  const padding =
    axis === 'width'
      ? parent.paddingLeft + parent.paddingRight
      : parent.paddingTop + parent.paddingBottom
  const gap =
    parent.primaryAxisAlign === 'SPACE_BETWEEN'
      ? 0
      : parent.itemSpacing * Math.max(0, childCount - 1)
  const available = axis === 'width' ? parent.width : parent.height
  const total = sizes.reduce<number>((sum, size) => sum + (size ?? 0), padding + gap)
  return Math.abs(total - available) < 0.001
}

function derivedMainAxisFitsParent(
  graph: LayoutGraph,
  parent: SceneNode,
  child: SceneNode,
  axis: 'width' | 'height'
): boolean {
  const children = graph
    .getChildren(parent.id)
    .filter((candidate) => candidate.visible && candidate.layoutPositioning !== 'ABSOLUTE')
  if (children.length === 0) return false

  const sizes = children.map((candidate) => candidate.figmaDerivedLayout?.[axis])
  return (
    sizesFitParent(parent, children.length, sizes, axis) &&
    child.figmaDerivedLayout?.[axis] !== undefined
  )
}

function usesAuthoritativeGeneratedStretch(parent: SceneNode, child: SceneNode): boolean {
  if (
    child.layoutAlignSelf !== 'STRETCH' ||
    parent.source.format === 'fig' ||
    !parent.figmaDerivedLayout
  ) {
    return false
  }
  const derivedCrossSize =
    parent.layoutMode === 'HORIZONTAL'
      ? parent.figmaDerivedLayout.height
      : parent.figmaDerivedLayout.width
  const parentCrossSize = parent.layoutMode === 'HORIZONTAL' ? parent.height : parent.width
  return derivedCrossSize !== undefined && Math.abs(derivedCrossSize - parentCrossSize) < 0.001
}

function configureAutoLayoutChildSizing(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: LayoutGraph,
  widthSizing: AxisSizing,
  heightSizing: AxisSizing
): void {
  const isParentRow = parent.layoutMode === 'HORIZONTAL'
  const fixedDerivedMainAxis = isParentRow
    ? derivedMainAxisFitsParent(graph, parent, child, 'width')
    : derivedMainAxisFitsParent(graph, parent, child, 'height')
  const stretchesAuthoritativeCrossAxis = usesAuthoritativeGeneratedStretch(parent, child)

  if (isParentRow) {
    if (fixedDerivedMainAxis) yogaChild.setWidth(child.figmaDerivedLayout?.width ?? child.width)
    else setMainAxisSizing(yogaChild, 'width', widthSizing, child.width, child.layoutGrow)
    if (!stretchesAuthoritativeCrossAxis) {
      setCrossAxisSizing(yogaChild, 'height', heightSizing, child.height)
    }
    return
  }

  if (!stretchesAuthoritativeCrossAxis) {
    setCrossAxisSizing(yogaChild, 'width', widthSizing, child.width)
  }
  if (fixedDerivedMainAxis) yogaChild.setHeight(child.figmaDerivedLayout?.height ?? child.height)
  else setMainAxisSizing(yogaChild, 'height', heightSizing, child.height, child.layoutGrow)
}

function* configureChildAsAutoLayoutSteps(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: LayoutGraph,
  inheritedDirection: 'LTR' | 'RTL'
): Generator<void, void, void> {
  const direction = resolveNodeLayoutDirection(child, inheritedDirection)
  const isChildRow = child.layoutMode === 'HORIZONTAL'
  const widthSizing = isChildRow ? child.primaryAxisSizing : child.counterAxisSizing
  const heightSizing = isChildRow ? child.counterAxisSizing : child.primaryAxisSizing

  configureAutoLayoutChildSizing(yogaChild, child, parent, graph, widthSizing, heightSizing)

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  if (usesDetachedDerivedLayout(child)) {
    const derived = child.figmaDerivedLayout
    if (widthSizing === 'HUG') yogaChild.setWidth(derived?.width ?? child.width)
    if (heightSizing === 'HUG') yogaChild.setHeight(derived?.height ?? child.height)
    applyMinMaxConstraints(yogaChild, child)
    return
  }

  configureFlexContainer(yogaChild, child, direction)

  const grandchildren = graph.getChildren(child.id)
  for (const gc of grandchildren) {
    yield
    const yogaGC = createYogaNode()
    yogaChild.insertChild(yogaGC, yogaChild.getChildCount())
    if (gc.layoutPositioning === 'ABSOLUTE') {
      configureAbsoluteChild(yogaGC, gc)
    } else if (!gc.visible) {
      yogaGC.setDisplay(Display.None)
    } else if (gc.layoutMode === 'GRID') {
      yield* configureChildAsGridSteps(yogaGC, gc, child, graph, direction)
    } else if (isAutoLayoutMode(gc.layoutMode)) {
      yield* configureChildAsAutoLayoutSteps(yogaGC, gc, child, graph, direction)
    } else {
      configureChildAsLeaf(yogaGC, gc, child, graph)
    }
  }
}

function derivedGrowingLeafFitsParent(
  graph: LayoutGraph,
  parent: SceneNode,
  child: SceneNode,
  axis: 'width' | 'height'
): boolean {
  if (
    child.type !== 'TEXT' ||
    child.layoutGrow <= 0 ||
    child.figmaDerivedLayout?.[axis] === undefined
  ) {
    return false
  }
  const children = graph
    .getChildren(parent.id)
    .filter((candidate) => candidate.visible && candidate.layoutPositioning !== 'ABSOLUTE')
  const sizes = children.map((candidate) => {
    if (candidate.layoutGrow > 0) return candidate.figmaDerivedLayout?.[axis]
    return axis === 'width' ? candidate.width : candidate.height
  })
  return sizesFitParent(parent, children.length, sizes, axis)
}

function configureTextLeafWithoutMeasurer(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  fixedDerivedMainAxis: boolean
): void {
  const hasStoredSize =
    child.width > 0 && child.height > 0 && !(child.width === 100 && child.height === 100)

  if (child.textAutoResize === 'WIDTH_AND_HEIGHT') {
    if (hasStoredSize) {
      yogaChild.setWidth(child.width)
      yogaChild.setHeight(child.height)
    } else {
      const estimated = estimateTextSize(child)
      yogaChild.setWidth(estimated.width)
      yogaChild.setHeight(estimated.height)
    }
    return
  }
  if (child.textAutoResize !== 'HEIGHT') return

  const isRow = parent.layoutMode === 'HORIZONTAL'
  const measurementWidth = fixedDerivedMainAxis
    ? (child.figmaDerivedLayout?.width ?? child.width)
    : child.width
  const stretches =
    child.layoutAlignSelf === 'STRETCH' ||
    (child.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
  if (!(!isRow && stretches) && !fixedDerivedMainAxis) yogaChild.setWidth(child.width)
  if (hasStoredSize) yogaChild.setHeight(child.height)
  else yogaChild.setHeight(estimateTextSize(child, measurementWidth).height)
}

function configureChildAsLeaf(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: LayoutGraph
): void {
  const isRow = parent.layoutMode === 'HORIZONTAL'
  const selfOverride = child.layoutAlignSelf !== 'AUTO'
  const stretchCross = selfOverride
    ? child.layoutAlignSelf === 'STRETCH'
    : parent.counterAxisAlign === 'STRETCH'

  const isText = child.type === 'TEXT'
  const textMeasurer = getTextMeasurer()
  const needsMeasureFunc = isText && textMeasurer && child.textAutoResize !== 'NONE'

  const fixedDerivedMainAxis = isRow
    ? derivedGrowingLeafFitsParent(graph, parent, child, 'width')
    : derivedGrowingLeafFitsParent(graph, parent, child, 'height')

  if (fixedDerivedMainAxis) {
    if (isRow) yogaChild.setWidth(child.figmaDerivedLayout?.width ?? child.width)
    else yogaChild.setHeight(child.figmaDerivedLayout?.height ?? child.height)
  }

  if (needsMeasureFunc) {
    configureTextLeaf(yogaChild, child, parent, fixedDerivedMainAxis)
  } else if (isText && !textMeasurer && child.textAutoResize !== 'NONE') {
    configureTextLeafWithoutMeasurer(yogaChild, child, parent, fixedDerivedMainAxis)
  } else {
    configureNonTextLeaf(yogaChild, child, isRow, stretchCross)
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  applyMinMaxConstraints(yogaChild, child)
}

function configureTextLeaf(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  fixedDerivedMainAxis = false
): void {
  const autoResize = child.textAutoResize
  const isRow = parent.layoutMode === 'HORIZONTAL'

  if (child.layoutGrow > 0 && !fixedDerivedMainAxis) {
    yogaChild.setFlexGrow(child.layoutGrow)
  }

  const cache = new Map<number, { width: number; height: number }>()
  const UNCONSTRAINED_KEY = -1

  if (autoResize === 'WIDTH_AND_HEIGHT') {
    const importedSize = child.figmaDerivedLayout
    if (importedSize?.width !== undefined && importedSize.height !== undefined) {
      yogaChild.setWidth(child.width)
      yogaChild.setHeight(child.height)
      return
    }

    yogaChild.setMeasureFunc((width, widthMode, _height, _heightMode) => {
      const maxW = widthMode === MeasureMode.Undefined ? undefined : width
      const cacheKey = maxW === undefined ? UNCONSTRAINED_KEY : Math.round(maxW)
      const cached = cache.get(cacheKey)
      if (cached) return cached

      const measured = getTextMeasurer()?.(child, maxW)
      const result = measured ?? estimateTextSize(child, maxW)
      cache.set(cacheKey, result)
      return result
    })
  } else if (autoResize === 'HEIGHT') {
    const stretchesCross =
      child.layoutAlignSelf === 'STRETCH' ||
      (child.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
    // Let Yoga stretch fill-width text instead of fixing its stored width.
    const fillsWidth = !isRow && stretchesCross
    const fixedWidth = fixedDerivedMainAxis
      ? (child.figmaDerivedLayout?.width ?? child.width)
      : child.width
    if (child.layoutGrow <= 0 && !fillsWidth) {
      yogaChild.setWidth(fixedWidth)
    }
    yogaChild.setMeasureFunc((width, widthMode, _height, _heightMode) => {
      let constraintW = fixedWidth
      if (fillsWidth) {
        if (widthMode !== MeasureMode.Undefined) constraintW = width
      } else if (widthMode !== MeasureMode.Undefined) {
        constraintW = Math.min(width, fixedWidth || width)
      }
      const cacheKey = Math.round(constraintW)
      const cached = cache.get(cacheKey)
      if (cached) return cached

      const measured = getTextMeasurer()?.(child, constraintW)
      const result = {
        width: constraintW,
        height: measured?.height ?? estimateTextSize(child, constraintW).height
      }
      cache.set(cacheKey, result)
      return result
    })
  }
}

function configureNonTextLeaf(
  yogaChild: YogaNode,
  child: SceneNode,
  isRow: boolean,
  stretchCross: boolean
): void {
  const w = child.width
  const h = child.height

  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow)
    if (!stretchCross) {
      if (isRow) yogaChild.setHeight(h)
      else yogaChild.setWidth(w)
    }
  } else {
    if (isRow) {
      yogaChild.setWidth(w)
      if (!stretchCross) yogaChild.setHeight(h)
    } else {
      yogaChild.setHeight(h)
      if (!stretchCross) yogaChild.setWidth(w)
    }
  }
}

function setMainAxisSizing(
  yogaNode: YogaNode,
  axis: 'width' | 'height',
  sizing: AxisSizing,
  fixedValue: number,
  grow: number
): void {
  if (grow > 0) {
    yogaNode.setFlexGrow(grow)
    yogaNode.setFlexShrink(1)
    yogaNode.setFlexBasis(0)
    return
  }

  switch (sizing) {
    case 'FIXED':
      if (axis === 'width') yogaNode.setWidth(fixedValue)
      else yogaNode.setHeight(fixedValue)
      break
    case 'HUG':
      break
    case 'FILL':
      yogaNode.setFlexGrow(1)
      yogaNode.setFlexShrink(1)
      yogaNode.setFlexBasis(0)
      break
  }
}

function setCrossAxisSizing(
  yogaNode: YogaNode,
  axis: 'width' | 'height',
  sizing: AxisSizing,
  fixedValue: number
): void {
  switch (sizing) {
    case 'FIXED':
      if (axis === 'width') yogaNode.setWidth(fixedValue)
      else yogaNode.setHeight(fixedValue)
      break
    case 'HUG':
      break
    case 'FILL':
      yogaNode.setAlignSelf(Align.Stretch)
      break
  }
}
