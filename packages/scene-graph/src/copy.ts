/**
 * Typed shallow-copy helpers for Fill, Stroke, Effect, and StyleRun.
 *
 * These replace `structuredClone` for known scene-graph array types,
 * avoiding the ~24× overhead of the generic deep-clone algorithm.
 * Each helper spreads the top-level object and any nested objects
 * (color, offset, gradientStops, dashPattern, style) to ensure
 * no shared references between source and copy.
 */

import type {
  ArcData,
  ComponentPropertyDefinition,
  Effect,
  FigmaDerivedTextGlyph,
  Fill,
  GeometryPath,
  GradientStop,
  LayoutGrid,
  LibraryRef,
  SceneNode,
  Stroke,
  StyleRun
} from './'
import {
  cloneGeneratedEffectSpec,
  cloneMotionDriverSpec,
  cloneMotionSceneSpec,
  cloneMotionSpec,
  clonePrototypeSpec,
  motionDriverNodeReferences,
  parseMotionTransitionKey,
  prototypeNodeReferences,
  remapMotionDriverNodeReferences,
  remapMotionSceneNodeReferences,
  remapPrototypeNodeReferences,
  validateMotionDriverSpec,
  validateMotionSceneSpec,
  validatePrototypeSpec
} from './motion'
import { createDefaultSourceMetadata } from './node-defaults'
import { cloneVectorNetwork } from './vector-network'

// --- Individual copy functions ---

export function copyFill(f: Fill): Fill {
  const copy: Fill = { ...f, color: { ...f.color } }
  if (f.gradientStops) copy.gradientStops = f.gradientStops.map(copyGradientStop)
  if (f.gradientTransform) copy.gradientTransform = { ...f.gradientTransform }
  if (f.imageTransform) copy.imageTransform = { ...f.imageTransform }
  if (f.patternSpacing) copy.patternSpacing = { ...f.patternSpacing }
  if (f.noiseSize) copy.noiseSize = { ...f.noiseSize }
  return copy
}

export function copyStroke(s: Stroke): Stroke {
  const copy: Stroke = { ...s, color: { ...s.color } }
  if (s.dashPattern) {
    copy.dashPattern = [...s.dashPattern]
  }
  return copy
}

export function copyEffect(e: Effect): Effect {
  return {
    ...e,
    color: { ...e.color },
    offset: { ...e.offset }
  }
}

export function copyStyleRun(r: StyleRun): StyleRun {
  return {
    ...r,
    style: {
      ...r.style,
      fills: r.style.fills ? r.style.fills.map(copyFill) : undefined,
      textDecorationFills: r.style.textDecorationFills
        ? r.style.textDecorationFills.map(copyFill)
        : undefined,
      fontVariations: r.style.fontVariations
        ? r.style.fontVariations.map((v) => ({ ...v }))
        : undefined,
      fontFeatures: r.style.fontFeatures ? r.style.fontFeatures.map((v) => ({ ...v })) : undefined
    }
  }
}

// --- Array copy functions ---

const internalCopySources = new WeakMap<object, object>()

/** Record immutable lineage for an internal deep copy without sharing mutable values. */
export function markCopySource<T extends object>(source: T, copy: T): T {
  internalCopySources.set(copy, internalCopySources.get(source) ?? source)
  return copy
}

/** Compare internal deep copies in O(1) without traversing large paint or text payloads. */
export function hasSameCopySource(left: object, right: object): boolean {
  if (left === right) return true
  return (internalCopySources.get(left) ?? left) === (internalCopySources.get(right) ?? right)
}

export function copyFills(fills: Fill[]): Fill[] {
  return fills.map(copyFill)
}

export function copyStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map(copyStroke)
}

export function copyEffects(effects: Effect[]): Effect[] {
  return effects.map(copyEffect)
}

export function copyLayoutGrids(grids: LayoutGrid[]): LayoutGrid[] {
  return grids.map((grid) => ({ ...grid, color: grid.color ? { ...grid.color } : undefined }))
}

export function copyStyleRuns(runs: StyleRun[]): StyleRun[] {
  return runs.map(copyStyleRun)
}

export function copyGeometryPaths(paths: GeometryPath[]): GeometryPath[] {
  return paths.map((p) => ({
    windingRule: p.windingRule,
    commandsBlob: p.commandsBlob.slice(),
    fills: p.fills ? copyFills(p.fills) : undefined
  }))
}

/** Scale geometry path coordinates while preserving independent path fills. */
export function scaleGeometryPaths(paths: GeometryPath[], scaleX: number, scaleY: number) {
  const copies = copyGeometryPaths(paths)
  if (scaleX === 1 && scaleY === 1) return copies

  for (const path of copies) {
    const view = new DataView(
      path.commandsBlob.buffer,
      path.commandsBlob.byteOffset,
      path.commandsBlob.byteLength
    )
    let offset = 0
    while (offset < path.commandsBlob.length) {
      const command = path.commandsBlob[offset]
      offset += 1
      if (command === 0) continue

      let coordinateCount = 0
      if (command === 1 || command === 2) coordinateCount = 1
      else if (command === 3) coordinateCount = 2
      else if (command === 4) coordinateCount = 3
      if (coordinateCount === 0 || offset + coordinateCount * 8 > path.commandsBlob.length) break
      for (let index = 0; index < coordinateCount; index++) {
        view.setFloat32(offset, view.getFloat32(offset, true) * scaleX, true)
        view.setFloat32(offset + 4, view.getFloat32(offset + 4, true) * scaleY, true)
        offset += 8
      }
    }
  }
  return copies
}

// --- Internal helpers ---

/** Copy an optional array: non-empty → mapped, empty → [], undefined → undefined. */
function copyOpt<T, U>(arr: T[] | undefined, fn: (arr: T[]) => U[]): U[] | undefined {
  if (arr === undefined) return undefined
  return arr.length > 0 ? fn(arr) : []
}

function copyGradientStop(gs: GradientStop): GradientStop {
  return { color: { ...gs.color }, position: gs.position }
}

function copySpread<T extends object>(arr: T[] | undefined): T[] {
  return arr?.map((item) => ({ ...item })) ?? []
}

function copyPropertyDefs(
  defs: ComponentPropertyDefinition[] | undefined
): ComponentPropertyDefinition[] {
  return (
    defs?.map((d) => ({
      ...d,
      variantOptions: d.variantOptions ? [...d.variantOptions] : undefined,
      preferredValues: d.preferredValues ? [...d.preferredValues] : undefined
    })) ?? []
  )
}

function copyLibraryRefs(libraries: LibraryRef[] | undefined): LibraryRef[] | undefined {
  return libraries?.map((library) => ({
    ...library,
    source: { ...library.source },
    importedComponents: library.importedComponents.map((component) => ({ ...component }))
  }))
}

function copyGlyphs(glyphs: FigmaDerivedTextGlyph[] | null): FigmaDerivedTextGlyph[] | null {
  return glyphs ? glyphs.map((g) => ({ ...g, commandsBlob: new Uint8Array(g.commandsBlob) })) : null
}

// --- Complex structure copy functions ---
// These replace structuredClone for known types, avoiding its ~24× overhead.

function copyArcData(a: ArcData): ArcData {
  return { startingAngle: a.startingAngle, endingAngle: a.endingAngle, innerRadius: a.innerRadius }
}

export type LowcodeNodeIdResolver = (nodeId: string) => string | undefined

interface LowcodeActionReference {
  [key: string]: unknown
  kind?: unknown
  targetNodeId?: unknown
}

function isLowcodeActionReference(value: unknown): value is LowcodeActionReference {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Recursively rewrite bounded Motion action targets. Actions may be nested in
 * condition/confirm branches, API callbacks, events, or document workflows.
 */
export function remapLowcodeMotionActionTargets(
  value: unknown,
  resolveNodeId: LowcodeNodeIdResolver
): boolean {
  if (Array.isArray(value)) {
    return value.reduce(
      (changed, item) => remapLowcodeMotionActionTargets(item, resolveNodeId) || changed,
      false
    )
  }
  if (!isLowcodeActionReference(value)) return false

  let changed = false
  if (
    (value.kind === 'playMotion' ||
      value.kind === 'stopMotion' ||
      value.kind === 'toggleMotion' ||
      value.kind === 'awaitMotion') &&
    typeof value.targetNodeId === 'string'
  ) {
    const nextId = resolveNodeId(value.targetNodeId)
    if (nextId && nextId !== value.targetNodeId) {
      value.targetNodeId = nextId
      changed = true
    }
  }
  for (const nested of Object.values(value)) {
    changed = remapLowcodeMotionActionTargets(nested, resolveNodeId) || changed
  }
  return changed
}

/**
 * Recursively rewrite one Motion track id without retargeting the action's node.
 * This mirrors {@link remapLowcodeMotionActionTargets} so references inside
 * condition/confirm branches, API callbacks, events, and workflows stay valid
 * when an author renames a track in the timeline.
 */
export function renameLowcodeMotionTrackReferences(
  value: unknown,
  targetNodeId: string,
  previousTrackId: string,
  nextTrackId: string
): boolean {
  if (Array.isArray(value)) {
    return value.reduce(
      (changed, item) =>
        renameLowcodeMotionTrackReferences(item, targetNodeId, previousTrackId, nextTrackId) ||
        changed,
      false
    )
  }
  if (!isLowcodeActionReference(value)) return false

  let changed = false
  if (
    (value.kind === 'playMotion' ||
      value.kind === 'stopMotion' ||
      value.kind === 'toggleMotion' ||
      value.kind === 'awaitMotion') &&
    value.targetNodeId === targetNodeId &&
    value.trackId === previousTrackId
  ) {
    value.trackId = nextTrackId
    changed = true
  }
  for (const nested of Object.values(value)) {
    changed =
      renameLowcodeMotionTrackReferences(nested, targetNodeId, previousTrackId, nextTrackId) ||
      changed
  }
  return changed
}

/** Return cloned lowcode fields only when at least one internal target changed. */
export function remapNodeLowcodeMotionActionTargets(
  node: Pick<SceneNode, 'events' | 'lowcodeWorkflows'>,
  resolveNodeId: LowcodeNodeIdResolver
): Pick<SceneNode, 'events' | 'lowcodeWorkflows'> | null {
  const updates: Pick<SceneNode, 'events' | 'lowcodeWorkflows'> = {}
  if (node.events) {
    const events = structuredClone(node.events)
    if (remapLowcodeMotionActionTargets(events, resolveNodeId)) updates.events = events
  }
  if (node.lowcodeWorkflows) {
    const workflows = structuredClone(node.lowcodeWorkflows)
    if (remapLowcodeMotionActionTargets(workflows, resolveNodeId)) {
      updates.lowcodeWorkflows = workflows
    }
  }
  return updates.events || updates.lowcodeWorkflows ? updates : null
}

/** Return a cloned scene choreography only when at least one included target was remapped. */
export function remapNodeMotionSceneTargets(
  node: Pick<SceneNode, 'motionScene'>,
  resolveNodeId: LowcodeNodeIdResolver
): Pick<SceneNode, 'motionScene'> | null {
  if (!node.motionScene) return null
  const changed = node.motionScene.sequences.some((sequence) =>
    sequence.cues.some((cue) => resolveNodeId(cue.targetNodeId) !== undefined)
  )
  if (!changed) return null
  return {
    motionScene: remapMotionSceneNodeReferences(node.motionScene, resolveNodeId)
  }
}

/** Return cloned continuous drivers only when an included source/target was remapped. */
export function remapNodeMotionDriverReferences(
  node: Pick<SceneNode, 'motionDrivers'>,
  resolveNodeId: LowcodeNodeIdResolver
): Pick<SceneNode, 'motionDrivers'> | null {
  if (!node.motionDrivers) return null
  const changed = motionDriverNodeReferences(node.motionDrivers).some(
    (nodeId) => resolveNodeId(nodeId) !== undefined
  )
  if (!changed) return null
  return {
    motionDrivers: remapMotionDriverNodeReferences(node.motionDrivers, resolveNodeId)
  }
}

/** Return cloned prototype connections only when an included destination was remapped. */
export function remapNodePrototypeTargets(
  node: Pick<SceneNode, 'prototype'>,
  resolveNodeId: LowcodeNodeIdResolver
): Pick<SceneNode, 'prototype'> | null {
  if (!node.prototype) return null
  const changed = prototypeNodeReferences(node.prototype).some(
    (nodeId) => resolveNodeId(nodeId) !== undefined
  )
  if (!changed) return null
  return {
    prototype: remapPrototypeNodeReferences(node.prototype, resolveNodeId)
  }
}

function remapInstanceOverrideValue(
  field: string,
  value: unknown,
  resolveNodeId: LowcodeNodeIdResolver
): { changed: boolean; value: unknown } {
  if (value === null) return { changed: false, value }
  if (field === 'motionScene') {
    const validated = validateMotionSceneSpec(value)
    if (!validated.success) return { changed: false, value }
    const changed = validated.value.sequences.some((sequence) =>
      sequence.cues.some((cue) => resolveNodeId(cue.targetNodeId) !== undefined)
    )
    return {
      changed,
      value: changed ? remapMotionSceneNodeReferences(validated.value, resolveNodeId) : value
    }
  }
  if (field === 'motionDrivers') {
    const validated = validateMotionDriverSpec(value)
    if (!validated.success) return { changed: false, value }
    const changed = motionDriverNodeReferences(validated.value).some(
      (nodeId) => resolveNodeId(nodeId) !== undefined
    )
    return {
      changed,
      value: changed ? remapMotionDriverNodeReferences(validated.value, resolveNodeId) : value
    }
  }
  if (field === 'prototype') {
    const validated = validatePrototypeSpec(value)
    if (!validated.success) return { changed: false, value }
    const changed = prototypeNodeReferences(validated.value).some(
      (nodeId) => resolveNodeId(nodeId) !== undefined
    )
    return {
      changed,
      value: changed ? remapPrototypeNodeReferences(validated.value, resolveNodeId) : value
    }
  }
  return { changed: false, value }
}

function remapInstanceOverrideKey(
  key: string,
  idMap: ReadonlyMap<string, string>
): { field: string; key: string; changed: boolean } {
  for (const [sourceId, cloneId] of idMap) {
    const prefix = `${sourceId}:`
    if (!key.startsWith(prefix)) continue
    return {
      field: key.slice(prefix.length),
      key: `${cloneId}:${key.slice(prefix.length)}`,
      changed: sourceId !== cloneId
    }
  }
  return { field: key, key, changed: false }
}

/** Remap instance override keys and embedded reusable Motion references during a clone/import.
 * Bare keys describe overrides on the instance root; `<nodeId>:<field>` keys describe
 * descendants. Null values remain explicit tombstones and external references stay intact. */
export function remapClonedInstanceOverrides(
  node: Pick<SceneNode, 'overrides'>,
  idMap: ReadonlyMap<string, string>
): Pick<SceneNode, 'overrides'> | null {
  if (Object.keys(node.overrides).length === 0) return null
  const resolveNodeId = (nodeId: string) => idMap.get(nodeId)
  const overrides: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(node.overrides)) {
    const remappedKey = remapInstanceOverrideKey(key, idMap)
    const remappedValue = remapInstanceOverrideValue(remappedKey.field, value, resolveNodeId)
    overrides[remappedKey.key] = remappedValue.value
    changed ||= remappedKey.changed || remappedValue.changed
  }
  return changed ? { overrides } : null
}

/** Remap references inside the load-time, path-keyed instance override carrier. */
export function remapPendingInstanceOverrideReferences(
  node: Pick<SceneNode, 'pendingInstanceOverrides'>,
  idMap: ReadonlyMap<string, string>
): Pick<SceneNode, 'pendingInstanceOverrides'> | null {
  if (!node.pendingInstanceOverrides) return null
  const resolveNodeId = (nodeId: string) => idMap.get(nodeId)
  const pendingInstanceOverrides: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(node.pendingInstanceOverrides)) {
    const field = key.slice(key.lastIndexOf(':') + 1)
    const remappedValue = remapInstanceOverrideValue(field, value, resolveNodeId)
    pendingInstanceOverrides[key] = remappedValue.value
    changed ||= remappedValue.changed
  }
  return changed ? { pendingInstanceOverrides } : null
}

/** Return cloned lowcode fields only when a track reference changed. */
export function renameNodeLowcodeMotionTrackReferences(
  node: Pick<SceneNode, 'events' | 'lowcodeWorkflows'>,
  targetNodeId: string,
  previousTrackId: string,
  nextTrackId: string
): Pick<SceneNode, 'events' | 'lowcodeWorkflows'> | null {
  const updates: Pick<SceneNode, 'events' | 'lowcodeWorkflows'> = {}
  if (node.events) {
    const events = structuredClone(node.events)
    if (renameLowcodeMotionTrackReferences(events, targetNodeId, previousTrackId, nextTrackId)) {
      updates.events = events
    }
  }
  if (node.lowcodeWorkflows) {
    const workflows = structuredClone(node.lowcodeWorkflows)
    if (renameLowcodeMotionTrackReferences(workflows, targetNodeId, previousTrackId, nextTrackId)) {
      updates.lowcodeWorkflows = workflows
    }
  }
  return updates.events || updates.lowcodeWorkflows ? updates : null
}

// --- Deep-copy clone props ---

/**
 * Build the init props for a deep-copy clone of `src`.
 * Shares logic between SceneGraph.cloneTree and instance child cloning.
 * Explicitly deep-copies all mutable object/array fields that `...rest`
 * would otherwise share by reference. When adding a mutable SceneNode field,
 * add its copy behavior here or document why sharing is intentional.
 */
export type NodeCloneMode = 'deep' | 'fig-import'

function cloneMotionAndActionProps(src: SceneNode): Partial<SceneNode> {
  const props: Partial<SceneNode> = {}
  if (src.motion) props.motion = cloneMotionSpec(src.motion)
  if (src.motionScene) props.motionScene = cloneMotionSceneSpec(src.motionScene)
  if (src.motionDrivers) props.motionDrivers = cloneMotionDriverSpec(src.motionDrivers)
  if (src.prototype) props.prototype = clonePrototypeSpec(src.prototype)
  if (src.transitionKey !== undefined) {
    props.transitionKey = parseMotionTransitionKey(src.transitionKey)
  }
  if (src.generatedEffect) props.generatedEffect = cloneGeneratedEffectSpec(src.generatedEffect)
  props.events = src.events ? structuredClone(src.events) : src.events
  props.lowcodeWorkflows = src.lowcodeWorkflows
    ? structuredClone(src.lowcodeWorkflows)
    : src.lowcodeWorkflows
  return props
}

export function cloneNodeProps(
  src: SceneNode,
  componentId: string | null,
  mode: NodeCloneMode = 'deep'
): Partial<SceneNode> {
  const { id: _, parentId: _p, childIds: _c, ...rest } = src
  const common = {
    ...rest,
    ...(componentId !== null ? { componentId } : {}),
    ...cloneMotionAndActionProps(src),
    boundVariables: { ...src.boundVariables },
    variableModes: { ...src.variableModes },
    overrides: Object.keys(src.overrides).length > 0 ? structuredClone(src.overrides) : {},
    componentPropertyAssignments: { ...src.componentPropertyAssignments },
    componentPropertyValues: { ...src.componentPropertyValues }
  }
  if (mode === 'fig-import') {
    return {
      ...common,
      source: createDefaultSourceMetadata()
    }
  }
  return {
    ...common,
    fills: copyOpt(src.fills, (value) => markCopySource(value, copyFills(value))),
    strokes: copyOpt(src.strokes, (value) => markCopySource(value, copyStrokes(value))),
    effects: copyOpt(src.effects, (value) => markCopySource(value, copyEffects(value))),
    layoutGrids: copyOpt(src.layoutGrids, copyLayoutGrids),
    styleRuns: copyOpt(src.styleRuns, (value) => markCopySource(value, copyStyleRuns(value))),
    // Generated instance descendants have no independent Figma provenance. Retaining the source
    // component's opaque raw payload here duplicates megabytes of metadata per instance.
    source: componentId === null ? structuredClone(src.source) : createDefaultSourceMetadata(),
    dashPattern: copyOpt(src.dashPattern, (a) => [...a]),
    fontVariations: copyOpt(src.fontVariations, (a) => a.map((v) => ({ ...v }))),
    fontFeatures: copyOpt(src.fontFeatures, (a) => a.map((v) => ({ ...v }))),
    textDecorationFills: copyOpt(src.textDecorationFills, copyFills),
    fillGeometry: copyOpt(src.fillGeometry, copyGeometryPaths),
    strokeGeometry: copyOpt(src.strokeGeometry, copyGeometryPaths),
    gridTemplateColumns: copySpread(src.gridTemplateColumns),
    gridTemplateRows: copySpread(src.gridTemplateRows),
    componentPropertyDefinitions: copyPropertyDefs(src.componentPropertyDefinitions),
    componentPropertyReferences: copySpread(src.componentPropertyReferences),
    symbolLinks: copySpread(src.symbolLinks),
    variantPropSpecs: copySpread(src.variantPropSpecs),
    pluginData: copySpread(src.pluginData),
    pluginRelaunchData: copySpread(src.pluginRelaunchData),
    exportSettings: copySpread(src.exportSettings),
    lowcodeLibraries: copyLibraryRefs(src.lowcodeLibraries),
    figmaDerivedLayout: src.figmaDerivedLayout ? { ...src.figmaDerivedLayout } : null,
    arcData: src.arcData ? copyArcData(src.arcData) : null,
    vectorNetwork: src.vectorNetwork ? cloneVectorNetwork(src.vectorNetwork) : null,
    textPicture: src.textPicture ? new Uint8Array(src.textPicture) : null,
    figmaDerivedTextGlyphs: src.figmaDerivedTextGlyphs
      ? markCopySource(src.figmaDerivedTextGlyphs, copyGlyphs(src.figmaDerivedTextGlyphs) ?? [])
      : null,
    gridPosition: src.gridPosition ? { ...src.gridPosition } : null
  }
}
