import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { NodeType, PluginDataEntry } from '@open-pencil/scene-graph'

/**
 * Export-only Figma compatibility layers carry this marker. OpenPencil folds
 * the marked layer trees back into their lowcode root when importing a .fig.
 */
export const FIGMA_PROJECTION_PLUGIN_KEY = 'lowcode/figmaProjection'
export const FIGMA_PROJECTION_VERSION = 1

export interface FigmaProjectionMarker {
  version: typeof FIGMA_PROJECTION_VERSION
  role: string
  field?: string
  index?: number
}

export type FigmaProjectionMarkerInput = Omit<FigmaProjectionMarker, 'version'>

export function createFigmaProjectionMarker(
  input: FigmaProjectionMarkerInput
): FigmaProjectionMarker {
  return { version: FIGMA_PROJECTION_VERSION, ...input }
}

export function createFigmaProjectionPluginData(
  input: FigmaProjectionMarkerInput
): PluginDataEntry {
  return {
    pluginId: OPEN_PENCIL_PLUGIN_ID,
    key: FIGMA_PROJECTION_PLUGIN_KEY,
    value: JSON.stringify(createFigmaProjectionMarker(input))
  }
}

type ProjectionNodeChange = Pick<NodeChange, 'pluginData' | 'textData' | 'type'>

export interface FigmaProjectionTree {
  getNode(id: string): ProjectionNodeChange | undefined
  getChildren(id: string): readonly string[]
}

export interface CollapsedFigmaProjection {
  /** Direct children that are real authored layers and must still be imported. */
  childIds: string[]
  /** Highest synthetic subtree roots removed from the imported SceneGraph. */
  collapsedChildIds: string[]
  /** Figma-edited visible strings to merge over persisted interactiveProps. */
  interactivePropsPatch: Record<string, unknown>
}

type FigImportedNodeType = NodeType | 'DOCUMENT' | 'VARIABLE'

const LOWCODE_PROJECTION_TYPES: ReadonlySet<string> = new Set([
  'BUTTON',
  'INPUT',
  'CHECKBOX',
  'FORM',
  'LIST',
  'SELECT',
  'RADIO',
  'TEXTAREA',
  'DATEPICKER',
  'SWITCH'
])

const IMPORTABLE_TEXT_FIELDS: Partial<Record<NodeType, ReadonlySet<string>>> = {
  BUTTON: new Set(['text']),
  INPUT: new Set(['placeholder', 'value']),
  TEXTAREA: new Set(['placeholder', 'value']),
  SELECT: new Set(['options', 'value']),
  CHECKBOX: new Set(['options']),
  RADIO: new Set(['options', 'value']),
  DATEPICKER: new Set(['value'])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMarkerValue(value: string): FigmaProjectionMarker | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (parsed.version !== FIGMA_PROJECTION_VERSION) return null
  if (typeof parsed.role !== 'string' || parsed.role.trim() === '') return null
  if (parsed.field !== undefined && typeof parsed.field !== 'string') return null
  if (
    parsed.index !== undefined &&
    (!Number.isInteger(parsed.index) || (parsed.index as number) < 0)
  ) {
    return null
  }
  return {
    version: FIGMA_PROJECTION_VERSION,
    role: parsed.role,
    ...(typeof parsed.field === 'string' ? { field: parsed.field } : {}),
    ...(typeof parsed.index === 'number' ? { index: parsed.index } : {})
  }
}

/** Parse a marker without treating malformed or future-version data as ours. */
export function readFigmaProjectionMarker(
  node: Pick<NodeChange, 'pluginData'>
): FigmaProjectionMarker | null {
  for (const entry of node.pluginData ?? []) {
    if (entry.pluginID === OPEN_PENCIL_PLUGIN_ID && entry.key === FIGMA_PROJECTION_PLUGIN_KEY) {
      const marker = parseMarkerValue(entry.value)
      if (marker) return marker
    }
  }
  return null
}

function isImportableTextField(nodeType: NodeType, field: string): boolean {
  return IMPORTABLE_TEXT_FIELDS[nodeType]?.has(field) ?? false
}

interface ProjectedText {
  field: string
  index?: number
  value: string
  order: number
}

function collectProjectedText(
  rootId: string,
  nodeType: NodeType,
  tree: FigmaProjectionTree,
  target: ProjectedText[],
  order: { value: number }
): void {
  const node = tree.getNode(rootId)
  if (!node) return
  const marker = readFigmaProjectionMarker(node)
  if (!marker) return

  const field = marker.field
  const text = node.type === 'TEXT' ? node.textData?.characters : undefined
  if (field && typeof text === 'string' && isImportableTextField(nodeType, field)) {
    target.push({ field, index: marker.index, value: text, order: order.value++ })
  }
  for (const childId of tree.getChildren(rootId)) {
    collectProjectedText(childId, nodeType, tree, target, order)
  }
}

function projectedTextPatch(
  entries: ProjectedText[],
  currentInteractiveProps?: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const options: ProjectedText[] = []
  for (const entry of entries) {
    if (entry.field === 'options') options.push(entry)
    else if (!(entry.field in patch)) patch[entry.field] = entry.value
  }
  if (options.length > 0) {
    options.sort((a, b) => (a.index ?? a.order) - (b.index ?? b.order) || a.order - b.order)
    const currentOptions = currentInteractiveProps?.options
    if (Array.isArray(currentOptions)) {
      const mergedOptions = [...currentOptions]
      const writtenIndexes = new Set<number>()
      for (const entry of options) {
        const index = entry.index ?? entry.order
        if (writtenIndexes.has(index)) continue
        mergedOptions[index] = entry.value
        writtenIndexes.add(index)
      }
      patch.options = mergedOptions
    } else {
      patch.options = options.map((entry) => entry.value)
    }
  }
  return patch
}

/**
 * Fold export-only Figma layers at a lowcode node boundary.
 *
 * Only marked direct children are removed. This makes each such child the
 * highest collapsed synthetic subtree while preserving real Figma-authored
 * siblings (and marked nodes nested below an unmarked real child).
 */
export function collapseFigmaProjectionChildren(
  nodeType: FigImportedNodeType,
  directChildIds: readonly string[],
  tree: FigmaProjectionTree,
  currentInteractiveProps?: Readonly<Record<string, unknown>>
): CollapsedFigmaProjection {
  if (!LOWCODE_PROJECTION_TYPES.has(nodeType)) {
    return {
      childIds: [...directChildIds],
      collapsedChildIds: [],
      interactivePropsPatch: {}
    }
  }

  const childIds: string[] = []
  const collapsedChildIds: string[] = []
  const projectedText: ProjectedText[] = []
  const order = { value: 0 }
  const lowcodeNodeType = nodeType as NodeType

  for (const childId of directChildIds) {
    const child = tree.getNode(childId)
    if (!child || !readFigmaProjectionMarker(child)) {
      childIds.push(childId)
      continue
    }
    collapsedChildIds.push(childId)
    collectProjectedText(childId, lowcodeNodeType, tree, projectedText, order)
  }

  return {
    childIds,
    collapsedChildIds,
    interactivePropsPatch: projectedTextPatch(projectedText, currentInteractiveProps)
  }
}
