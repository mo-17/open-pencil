import type {
  ComponentPropertyDefinition,
  SceneGraph,
  SceneNode,
  NodeType
} from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { parseColor } from '#core/color'
import type { RenderOptions } from '#core/design-jsx/types'
import { fetchIcons } from '#core/icons'
import { createIconFromPaths } from '#core/icons/render'
import { extractPaths, scalePathInfos } from '#core/icons/svg'
import type { IconData } from '#core/icons/types'
import { computeAllLayoutsAsync } from '#core/layout'
import { randomHex } from '#core/random'

import {
  isLowcodeNodeType,
  LOWCODE_TYPE_MAP,
  prepareLowcodeProps,
  type PreparedLowcodeProps
} from './lowcode'
import { applySizeOverrides, propsToOverrides } from './props-overrides'
import { isTreeNode } from './tree'
import type { TreeNode } from './tree'
import { isVariable, type DesignVariable } from './vars'

const TYPE_MAP: Partial<Record<string, NodeType>> = {
  frame: 'FRAME',
  view: 'FRAME',
  rectangle: 'RECTANGLE',
  rect: 'RECTANGLE',
  ellipse: 'ELLIPSE',
  text: 'TEXT',
  line: 'LINE',
  star: 'STAR',
  polygon: 'POLYGON',
  vector: 'VECTOR',
  group: 'GROUP',
  section: 'SECTION',
  component: 'COMPONENT',
  'component-set': 'COMPONENT_SET',
  componentset: 'COMPONENT_SET',
  div: 'FRAME',
  main: 'FRAME',
  header: 'FRAME',
  footer: 'FRAME',
  nav: 'FRAME',
  article: 'FRAME',
  aside: 'FRAME',
  span: 'TEXT',
  p: 'TEXT',
  h1: 'TEXT',
  h2: 'TEXT',
  h3: 'TEXT',
  h4: 'TEXT',
  h5: 'TEXT',
  h6: 'TEXT',
  ...LOWCODE_TYPE_MAP
}

export interface RenderResult {
  id: string
  name: string
  type: NodeType
  childIds: string[]
  warnings?: string[]
}

export async function renderTree(
  graph: SceneGraph,
  tree: TreeNode,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const parentId = options.parentId ?? graph.getPages()[0].id
  const warnings: string[] = []
  const lowcodeProps = new Map<TreeNode, PreparedLowcodeProps>()
  const execution: RenderExecution = {
    signal: options.signal,
    rootParentId: parentId,
    createdRootIds: new Set(),
    workSinceYield: 0
  }
  throwIfRenderAborted(options.signal)
  await preflightLowcodeTreeAsync(tree, lowcodeProps, warnings, execution)
  throwIfRenderAborted(options.signal)

  try {
    const result = await renderNode(graph, tree, parentId, lowcodeProps, execution)
    throwIfRenderAborted(options.signal)

    if (options.x !== undefined) graph.updateNode(result.id, { x: options.x })
    if (options.y !== undefined) graph.updateNode(result.id, { y: options.y })

    if (options.layout !== false) {
      await computeAllLayoutsAsync(graph, findOwningPageId(graph, parentId), options.signal)
      throwIfRenderAborted(options.signal)
    }

    return {
      id: result.id,
      name: result.name,
      type: result.type,
      childIds: result.childIds,
      ...(warnings.length > 0 ? { warnings } : {})
    }
  } catch (error) {
    // A child Icon/fetch/layout failure must not leave its already-created
    // root (and descendants) behind on the page.
    for (const childId of execution.createdRootIds) graph.deleteNode(childId)
    throw error
  }
}

interface RenderExecution {
  signal?: AbortSignal
  rootParentId: string
  createdRootIds: Set<string>
  workSinceYield: number
}

function throwIfRenderAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('JSX render cancelled')
  error.name = 'AbortError'
  throw error
}

async function checkpointRender(execution: RenderExecution, force = false): Promise<void> {
  throwIfRenderAborted(execution.signal)
  execution.workSinceYield++
  if (!force && execution.workSinceYield < 32) return
  execution.workSinceYield = 0
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      execution.signal?.removeEventListener('abort', onAbort)
      resolve()
    }, 0)
    const onAbort = () => {
      clearTimeout(timeout)
      execution.signal?.removeEventListener('abort', onAbort)
      const error = new Error('JSX render cancelled')
      error.name = 'AbortError'
      reject(error)
    }
    execution.signal?.addEventListener('abort', onAbort, { once: true })
  })
  throwIfRenderAborted(execution.signal)
}

function findOwningPageId(graph: SceneGraph, nodeId: string): string {
  const visited = new Set<string>()
  let current = graph.getNode(nodeId)
  while (current && !visited.has(current.id)) {
    if (current.type === 'CANVAS') return current.id
    visited.add(current.id)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return nodeId
}

function buttonTextFromTree(tree: TreeNode, nodeType: NodeType): string | undefined {
  if (nodeType !== 'BUTTON' || tree.children.length === 0) return undefined
  if (!tree.children.every((child) => typeof child === 'string')) return undefined
  return tree.children.join('')
}

function preflightLowcodeTree(
  tree: TreeNode,
  preparedByTree: Map<TreeNode, PreparedLowcodeProps>,
  warnings: string[]
): void {
  const nodeType = TYPE_MAP[tree.type.toLowerCase()]
  if (nodeType && isLowcodeNodeType(nodeType)) {
    const prepared = prepareLowcodeProps(
      nodeType,
      tree.type,
      tree.props,
      buttonTextFromTree(tree, nodeType)
    )
    preparedByTree.set(tree, prepared)
    warnings.push(...prepared.warnings)
  }
  for (const child of tree.children) {
    if (isTreeNode(child)) preflightLowcodeTree(child, preparedByTree, warnings)
  }
}

async function preflightLowcodeTreeAsync(
  tree: TreeNode,
  preparedByTree: Map<TreeNode, PreparedLowcodeProps>,
  warnings: string[],
  execution: RenderExecution
): Promise<void> {
  const pending = [tree]
  while (pending.length > 0) {
    await checkpointRender(execution)
    const current = pending.pop()
    if (!current) continue
    const nodeType = TYPE_MAP[current.type.toLowerCase()]
    if (nodeType && isLowcodeNodeType(nodeType)) {
      const prepared = prepareLowcodeProps(
        nodeType,
        current.type,
        current.props,
        buttonTextFromTree(current, nodeType)
      )
      preparedByTree.set(current, prepared)
      warnings.push(...prepared.warnings)
    }
    for (let index = current.children.length - 1; index >= 0; index--) {
      const child = current.children[index]
      if (isTreeNode(child)) pending.push(child)
    }
  }
}

/** Validate every lowcode node before a JSX render starts mutating the graph. */
export function validateTreeForRender(tree: TreeNode): void {
  preflightLowcodeTree(tree, new Map(), [])
}

/** Cooperative preflight used before any graph mutation on generated trees. */
export async function validateTreeForRenderAsync(
  tree: TreeNode,
  signal?: AbortSignal
): Promise<void> {
  const execution: RenderExecution = {
    signal,
    rootParentId: '',
    createdRootIds: new Set(),
    workSinceYield: 0
  }
  await preflightLowcodeTreeAsync(tree, new Map(), [], execution)
  throwIfRenderAborted(signal)
}

interface PreparedProps {
  props: Record<string, unknown>
  bindings: Record<string, string>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveVariableId(graph: SceneGraph, variable: DesignVariable): string | undefined {
  if (variable.id && graph.variables.has(variable.id)) return variable.id
  if (variable.id && !variable.name) return variable.id
  for (const candidate of graph.variables.values()) {
    if (candidate.name === variable.name || candidate.id === variable.name) return candidate.id
  }
  return variable.id
}

function variableFallback(graph: SceneGraph, variable: DesignVariable): string | Color | undefined {
  if (variable.value !== undefined) return variable.value
  const variableId = resolveVariableId(graph, variable)
  return variableId ? graph.resolveColorVariable(variableId) : undefined
}

function bindVariableProp(
  graph: SceneGraph,
  props: Record<string, unknown>,
  bindings: Record<string, string>,
  key: string,
  field: string
): void {
  const value = props[key]
  if (!isVariable(value)) return
  const variableId = resolveVariableId(graph, value)
  if (variableId) bindings[field] = variableId
  const fallback = variableFallback(graph, value)
  if (fallback !== undefined) props[key] = fallback
}

function bindStyleVariableProp(
  graph: SceneGraph,
  style: Record<string, unknown>,
  bindings: Record<string, string>,
  key: string,
  field: string
): void {
  const value = style[key]
  if (!isVariable(value)) return
  const variableId = resolveVariableId(graph, value)
  if (variableId) bindings[field] = variableId
  const fallback = variableFallback(graph, value)
  if (fallback !== undefined) style[key] = fallback
}

function preparePropsForRender(
  graph: SceneGraph,
  source: Record<string, unknown>,
  isText: boolean
): PreparedProps {
  const props = { ...source }
  const bindings: Record<string, string> = {}

  if (Array.isArray(props.fills)) {
    props.fills = props.fills.map((value, index) => {
      if (!isVariable(value)) return value
      const variableId = resolveVariableId(graph, value)
      if (variableId) bindings[`fills/${index}/color`] = variableId
      return variableFallback(graph, value) ?? value
    })
  }

  for (const key of ['bg', 'fill', 'background', 'backgroundColor']) {
    bindVariableProp(graph, props, bindings, key, 'fills/0/color')
  }
  if (isText) bindVariableProp(graph, props, bindings, 'color', 'fills/0/color')
  for (const key of ['stroke', 'border', 'borderColor']) {
    bindVariableProp(graph, props, bindings, key, 'strokes/0/color')
  }

  if (isObjectRecord(props.style)) {
    const style = { ...props.style }
    for (const key of ['background', 'backgroundColor']) {
      bindStyleVariableProp(graph, style, bindings, key, 'fills/0/color')
    }
    if (isText) bindStyleVariableProp(graph, style, bindings, 'color', 'fills/0/color')
    bindStyleVariableProp(graph, style, bindings, 'borderColor', 'strokes/0/color')
    props.style = style
  }

  if (isObjectRecord(props.bind)) {
    for (const [field, value] of Object.entries(props.bind)) {
      if (isVariable(value)) {
        const variableId = resolveVariableId(graph, value)
        if (variableId) bindings[field] = variableId
      } else if (typeof value === 'string') {
        bindings[field] = value
      }
    }
  }

  return { props, bindings }
}

function applyBindings(graph: SceneGraph, nodeId: string, bindings: Record<string, string>): void {
  for (const [field, variableId] of Object.entries(bindings)) {
    graph.bindVariable(nodeId, field, variableId)
  }
}

function applyIconSize(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>,
  parentLayout: SceneNode['layoutMode'],
  size: number
): void {
  const { w, h } = applySizeOverrides(props, overrides, parentLayout)
  if (typeof w !== 'number') overrides.width = size
  if (typeof h !== 'number') overrides.height = size
}

function finishIconRender(
  graph: SceneGraph,
  icon: IconData,
  props: Record<string, unknown>,
  size: number,
  color: Color,
  parentId: string
): SceneNode {
  const parent = graph.getNode(parentId)
  const parentLayout = parent?.layoutMode ?? 'NONE'
  const overrides: Partial<SceneNode> = {}
  if (props.label) overrides.name = props.label as string
  applyIconSize(props, overrides, parentLayout, size)
  return createIconFromPaths(graph, icon, icon.name, size, color, parentId, overrides)
}

async function renderIconNode(
  graph: SceneGraph,
  tree: TreeNode,
  parentId: string,
  signal?: AbortSignal
): Promise<SceneNode> {
  const props = tree.props
  const iconName = props.name as string | undefined
  if (!iconName) throw new Error('<Icon> requires a name prop (e.g. name="lucide:heart")')

  const size = (props.size as number | undefined) ?? 24
  const colorHex = (props.color as string | undefined) ?? '#000000'
  const parsedColor = parseColor(colorHex)

  throwIfRenderAborted(signal)
  const icons = await fetchIcons([iconName], size, signal)
  throwIfRenderAborted(signal)
  const icon = icons.get(iconName)
  if (!icon || icon.paths.length === 0) {
    throw new Error(`Icon "${iconName}" not found`)
  }
  return finishIconRender(graph, icon, props, size, parsedColor, parentId)
}

/**
 * Render an inline <svg> element into vector nodes. Reuses the same SVG-path
 * pipeline as iconify icons: the body may be passed as string children or a
 * `body`/`children` string prop, and is parsed with extractPaths + parseSVGPath.
 */
async function renderSvgNode(
  graph: SceneGraph,
  tree: TreeNode,
  parentId: string
): Promise<SceneNode> {
  const props = tree.props
  const explicitW = typeof props.w === 'number' ? props.w : 0
  const explicitH = typeof props.h === 'number' ? props.h : 0
  const size =
    explicitW > 0 || explicitH > 0
      ? Math.max(explicitW, explicitH)
      : ((props.size as number | undefined) ?? 24)
  const colorHex = (props.color as string | undefined) ?? '#000000'
  const parsedColor = parseColor(colorHex)

  const body =
    (typeof props.body === 'string' && props.body) ||
    tree.children.filter((c): c is string => typeof c === 'string').join('')

  // Children may arrive as parsed <path>/<circle>/etc. elements (mini-react
  // lowercases tags) rather than raw markup. Rebuild path info from either
  // source: raw SVG markup, or element children carrying a `d` attribute.
  let pathInfos = body.trim() ? extractPaths(body) : []
  if (pathInfos.length === 0) {
    pathInfos = tree.children
      .filter(isTreeNode)
      .map((child) => {
        const d = (child.props.d ?? child.props.body) as string | undefined
        if (!d) return null
        return {
          d,
          fill: (child.props.fill as string | undefined) ?? 'currentColor',
          stroke: (child.props.stroke as string | undefined) ?? null,
          strokeWidth: Number(child.props['stroke-width'] ?? child.props.strokeWidth ?? 1),
          strokeCap: (child.props['stroke-linecap'] as string | undefined) ?? 'butt',
          strokeJoin: (child.props['stroke-linejoin'] as string | undefined) ?? 'miter',
          fillRule:
            (child.props['fill-rule'] as string | undefined) === 'evenodd'
              ? ('EVENODD' as const)
              : ('NONZERO' as const)
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
  }
  if (pathInfos.length === 0) {
    throw new Error(
      '<svg> requires SVG markup as children, a body prop, or <path d="..."> children'
    )
  }

  const vb = parseViewBox(props.viewBox as string | undefined)
  const scaleX = vb.w > 0 ? size / vb.w : 1
  const scaleY = vb.h > 0 ? size / vb.h : 1

  const icon: IconData = {
    prefix: 'svg',
    name: (props.name as string | undefined) ?? 'custom',
    width: size,
    height: size,
    paths: scalePathInfos(pathInfos, scaleX, scaleY)
  }
  return finishIconRender(graph, icon, props, size, parsedColor, parentId)
}

function parseViewBox(viewBox: string | undefined): { w: number; h: number } {
  if (!viewBox) return { w: 0, h: 0 }
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const w = parts[2] ?? 0
  const h = parts[3] ?? 0
  return { w, h }
}

function parseVariantValues(name: string): Record<string, string> {
  const entries = name
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const values: Record<string, string> = {}
  for (const entry of entries) {
    const [key = '', ...rest] = entry.split('=')
    const property = key.trim()
    const value = rest.join('=').trim()
    if (property && value) values[property] = value
  }
  return values
}

function inferComponentSetProperties(graph: SceneGraph, componentSetId: string): void {
  const componentSet = graph.getNode(componentSetId)
  if (componentSet?.type !== 'COMPONENT_SET') return
  if (componentSet.componentPropertyDefinitions.length > 0) return

  const variants = graph.getChildren(componentSetId).filter((node) => node.type === 'COMPONENT')
  const options = new Map<string, Set<string>>()
  const valuesById = new Map<string, Record<string, string>>()

  for (const variant of variants) {
    const values = parseVariantValues(variant.name)
    valuesById.set(variant.id, values)
    for (const [property, value] of Object.entries(values)) {
      let set = options.get(property)
      if (!set) {
        set = new Set()
        options.set(property, set)
      }
      set.add(value)
    }
  }

  const definitions: ComponentPropertyDefinition[] = [...options.entries()].map(
    ([name, values]) => {
      const variantOptions = [...values]
      return {
        id: `prop:${randomHex(8)}`,
        name,
        type: 'VARIANT',
        defaultValue: variantOptions[0] ?? '',
        variantOptions
      }
    }
  )
  if (definitions.length === 0) return

  for (const [id, values] of valuesById) {
    graph.updateNode(id, { componentPropertyValues: values })
  }
  graph.updateNode(componentSetId, { componentPropertyDefinitions: definitions })
}

function findComponentByName(graph: SceneGraph, name: string): SceneNode | undefined {
  for (const node of graph.getAllNodes()) {
    if (node.type === 'COMPONENT' && node.name === name) return node
  }
  return undefined
}

function findVariantInSet(
  graph: SceneGraph,
  componentSet: SceneNode,
  props: Record<string, unknown>
) {
  const requested = Object.fromEntries(
    Object.entries(props)
      .filter(([key]) => !['component', 'componentId', 'of', 'name', 'children'].includes(key))
      .map(([key, value]) => [key, String(value)])
  )
  const variants = graph.getChildren(componentSet.id).filter((node) => node.type === 'COMPONENT')
  return (
    variants.find((variant) =>
      Object.entries(requested).every(
        ([key, value]) => variant.componentPropertyValues[key] === value
      )
    ) ?? variants[0]
  )
}

function resolveComponent(
  graph: SceneGraph,
  props: Record<string, unknown>
): SceneNode | undefined {
  const ref = props.component ?? props.componentId ?? props.of
  if (typeof ref !== 'string') return undefined

  const byId = graph.getNode(ref)
  if (byId?.type === 'COMPONENT') return byId
  if (byId?.type === 'COMPONENT_SET') return findVariantInSet(graph, byId, props)

  const byName = findComponentByName(graph, ref)
  if (byName) return byName

  for (const node of graph.getAllNodes()) {
    if (node.type === 'COMPONENT_SET' && node.name === ref)
      return findVariantInSet(graph, node, props)
  }
  return undefined
}

async function renderInstanceNode(
  graph: SceneGraph,
  tree: TreeNode,
  parentId: string
): Promise<SceneNode> {
  const parent = graph.getNode(parentId)
  const parentLayout = parent?.layoutMode ?? 'NONE'
  const { props, bindings } = preparePropsForRender(graph, tree.props, false)
  const component = resolveComponent(graph, props)
  if (!component) {
    const ref = props.component ?? props.componentId ?? props.of
    const label = typeof ref === 'string' || typeof ref === 'number' ? String(ref) : ''
    throw new Error(`<Instance> component not found: ${label}`)
  }
  const overrides = propsToOverrides(props, false, parentLayout)
  const instance =
    graph.createInstance(component.id, parentId, overrides) ?? graph.createNode('FRAME', parentId)
  applyBindings(graph, instance.id, bindings)
  applyInstanceOverrides(graph, instance, tree.props.overrides)
  return instance
}

function applyPreparedLowcodeProps(
  graph: SceneGraph,
  node: SceneNode,
  prepared: PreparedLowcodeProps | undefined
): void {
  if (!prepared?.interactiveProps) return
  graph.updateNode(node.id, {
    interactiveProps: { ...node.interactiveProps, ...prepared.interactiveProps }
  })
}

/**
 * Apply child overrides to a freshly created instance. Keys are
 * `childName:prop` (e.g. 'label:text', 'icon:fills'); the child is resolved by
 * name among the instance's descendants, and the value is applied to both the
 * child node and the instance's overrides record so component sync keeps it.
 */
function applyInstanceOverrides(
  graph: SceneGraph,
  instance: SceneNode,
  overridesProp: unknown
): void {
  if (!overridesProp || typeof overridesProp !== 'object') return
  if (Array.isArray(overridesProp)) return
  const entries = Object.entries(overridesProp)
  if (entries.length === 0) return

  const descendants: SceneNode[] = []
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    descendants.push(node)
    for (const cid of node.childIds) walk(cid)
  }
  walk(instance.id)

  const overrides: Record<string, unknown> = { ...instance.overrides }
  for (const [key, value] of entries) {
    const sep = key.indexOf(':')
    if (sep === -1) continue
    const childName = key.slice(0, sep)
    const prop = key.slice(sep + 1)
    const child = descendants.find((n) => n.name === childName)
    if (!child || !(prop in child)) continue
    graph.updateNode(child.id, { [prop]: value } as Partial<SceneNode>)
    overrides[`${child.id}:${prop}`] = value
  }
  if (Object.keys(overrides).length > 0) {
    graph.updateNode(instance.id, { overrides })
  }
}

async function renderNode(
  graph: SceneGraph,
  tree: TreeNode,
  parentId: string,
  lowcodeProps: Map<TreeNode, PreparedLowcodeProps>,
  execution: RenderExecution
): Promise<SceneNode> {
  await checkpointRender(execution)
  const elementType = tree.type.toLowerCase()
  if (elementType === 'icon') {
    const node = await renderIconNode(graph, tree, parentId, execution.signal)
    trackCreatedRoot(execution, parentId, node.id)
    await checkpointRender(execution, true)
    return node
  }
  if (elementType === 'svg') {
    const node = await renderSvgNode(graph, tree, parentId)
    trackCreatedRoot(execution, parentId, node.id)
    await checkpointRender(execution)
    return node
  }
  if (elementType === 'instance') {
    const node = await renderInstanceNode(graph, tree, parentId)
    trackCreatedRoot(execution, parentId, node.id)
    await checkpointRender(execution)
    return node
  }

  const nodeType = TYPE_MAP[elementType]
  if (!nodeType) throw new Error(`Unknown element: <${tree.type}>`)

  const parent = graph.getNode(parentId)
  const parentLayout = parent?.layoutMode ?? 'NONE'

  const isText = nodeType === 'TEXT'
  const { props, bindings } = preparePropsForRender(graph, tree.props, isText)
  const overrides = propsToOverrides(props, isText, parentLayout)
  const preparedLowcode = lowcodeProps.get(tree)

  if (isText) {
    const childText = tree.children.filter((c): c is string => typeof c === 'string').join('')
    const propText =
      props.text ?? props.characters ?? props.content ?? props.label ?? props.value ?? props.title
    if (childText) overrides.text = childText
    else if (typeof propText === 'string') overrides.text = propText
  }

  const node = graph.createNode(nodeType, parentId, overrides)
  trackCreatedRoot(execution, parentId, node.id)
  applyPreparedLowcodeProps(graph, node, preparedLowcode)
  applyBindings(graph, node.id, bindings)

  for (const child of tree.children) {
    if (typeof child === 'string') continue
    if (isTreeNode(child)) {
      await renderNode(graph, child, node.id, lowcodeProps, execution)
    }
  }

  if (node.type === 'COMPONENT_SET') inferComponentSetProperties(graph, node.id)

  return node
}

function trackCreatedRoot(execution: RenderExecution, parentId: string, nodeId: string): void {
  if (parentId === execution.rootParentId) execution.createdRootIds.add(nodeId)
}
