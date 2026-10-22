import { sha1 } from '@noble/hashes/legacy.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { omit } from 'es-toolkit'

import { readBehaviour } from '../behaviours/model'
import type { SceneGraph } from '../index'
import type { SceneNode } from '../types'
import { readShaderPaints, shaderOfPaint, withShaderPaints } from './model'

const CONTENT_TYPES = new Set(['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'GROUP'])

function hasRuntimeContent(node: SceneNode): boolean {
  return Boolean(
    node.motion ||
    node.motionScene ||
    node.motionDrivers ||
    node.generatedEffect ||
    node.prototype ||
    readBehaviour(node) ||
    Object.keys(node.bindings ?? {}).length ||
    Object.keys(node.events ?? {}).length ||
    Object.keys(node.interactiveProps ?? {}).length ||
    Object.keys(node.boundVariables).length ||
    node.renderCondition ||
    node.state?.length
  )
}

/** Only static decorative subtrees can be flattened; controls and runtime contracts stay live. */
export function supportsShaderContent(graph: SceneGraph, root: SceneNode): boolean {
  const pending = [root]
  const seen = new Set<string>()
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (seen.has(node.id)) return false
    seen.add(node.id)
    if (
      !CONTENT_TYPES.has(node.type) ||
      node.isMask ||
      (node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') ||
      hasRuntimeContent(node) ||
      (node.id !== root.id && readShaderPaints(node).some((shader) => shader.input))
    )
      return false
    for (const id of node.childIds) {
      const child = graph.getNode(id)
      if (child) pending.push(child)
    }
  }
  return true
}

/** The active content shader, if the whole subtree can safely be represented as pixels. */
export function contentShader(graph: SceneGraph, node: SceneNode) {
  const paint = node.fills.findLast(
    (fill) => fill.visible && shaderOfPaint(node, fill)?.input?.kind === 'self'
  )
  const shader = paint && shaderOfPaint(node, paint)
  return shader && supportsShaderContent(graph, node) ? { paint, shader } : null
}

/** The source retains all original paints, excluding the content shader itself. */
export function withoutContentShader(node: SceneNode): SceneNode {
  if (!readShaderPaints(node).some((shader) => shader.input)) return node
  const fills = node.fills.filter((fill) => !shaderOfPaint(node, fill)?.input)
  return { ...node, fills, pluginData: withShaderPaints(node, [...fills, ...node.strokes]) }
}

/** A read-only projection; the authored text, children and controls are never changed. */
export function shaderContentNode(graph: SceneGraph, node: SceneNode): SceneNode {
  const content = contentShader(graph, node)
  if (!content || !graph.images.get(content.shader.image)?.length) return withoutContentShader(node)
  return {
    ...node,
    type: 'RECTANGLE',
    fills: [content.paint],
    strokes: [],
    effects: [],
    childIds: [],
    text: '',
    cornerRadius: 0,
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomLeftRadius: 0,
    bottomRightRadius: 0,
    fillGeometry: [],
    strokeGeometry: [],
    layoutGrids: [],
    layoutMode: 'NONE'
  }
}

/** A content signature survives save/undo and also catches image bytes replaced under one hash. */
export function shaderContentKey(graph: SceneGraph, root: SceneNode): string {
  const nodes: Omit<SceneNode, 'source'>[] = []
  const pending = [root]
  const seen = new Set<string>()
  const images = new Map<string, string>()
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    const source = node.id === root.id ? withoutContentShader(node) : node
    nodes.push(omit(source, ['source']))
    for (const fill of [...source.fills, ...source.strokes]) {
      if (!fill.imageHash) continue
      const bytes = graph.images.get(fill.imageHash)
      images.set(fill.imageHash, bytes ? bytesToHex(sha1(bytes)) : '')
    }
    for (const id of source.childIds) {
      const child = graph.getNode(id)
      if (child) pending.push(child)
    }
  }
  return bytesToHex(sha1(utf8ToBytes(JSON.stringify([nodes, [...images]]))))
}

/** Static targets can reuse saved bytes after a GPU failure, but never claim a missing frame. */
export function assertShaderFrames(
  graph: SceneGraph,
  nodeIds: readonly string[],
  proceduralRuntime = false
): void {
  for (const node of graph.getAllNodes()) {
    if (readShaderPaints(node).length === 0) continue
    if (!nodeIds.some((id) => node.id === id || graph.isDescendant(node.id, id))) continue
    for (const paint of [...node.fills, ...node.strokes]) {
      const shader = paint.visible && shaderOfPaint(node, paint)
      if (
        !shader ||
        (proceduralRuntime && !shader.input) ||
        (shader.input && !supportsShaderContent(graph, node))
      )
        continue
      if (!graph.images.get(shader.image)?.length)
        throw new Error(`No usable saved Shader frame for layer ${node.name}`)
    }
  }
}
