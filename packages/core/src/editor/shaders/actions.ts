import { pick } from 'es-toolkit'

import {
  createShaderPaint,
  supportsShaderContent,
  readShaderPaints,
  shaderOfPaint,
  withShaderPaints,
  type SceneNode,
  type ShaderPreset,
  type Stroke
} from '@open-pencil/scene-graph'

import type { EditorContext } from '#core/editor/types'

/** What a stroke has beyond its paint. */
const STROKE_FIELDS = [
  'weight',
  'align',
  'cap',
  'join',
  'dashPattern'
] as const satisfies readonly (keyof Stroke)[]

const replaceAt = <T>(items: readonly T[], index: number, item: T) =>
  items.map((existing, at) => (at === index ? item : existing))

/** Which of a layer's paint lists a shader is set in. */
export type ShaderPaintList = 'fills' | 'strokes'

interface NodeActions {
  updateNodeWithUndo(id: string, changes: Partial<SceneNode>, label?: string): void
}

/**
 * Shader paint commands. A shader paint is an image paint of the shader's frame plus the preset
 * in plugin data, so each command records both together, as one undo step.
 */
export function createShaderActions(ctx: EditorContext, nodes: NodeActions) {
  function setNodeShader(
    nodeId: string,
    list: ShaderPaintList,
    index: number,
    preset: ShaderPreset
  ): void {
    const node = ctx.graph.getNode(nodeId)
    const previous = node?.[list].at(index)
    if (!node || !previous) return
    const existing = shaderOfPaint(node, previous)
    const { paint, shader } = existing
      ? {
          paint: previous,
          shader: { ...existing, preset: structuredClone(preset), frame: undefined }
        }
      : createShaderPaint(preset)
    const shown = { ...paint, opacity: previous.opacity, visible: previous.visible }
    const fills = list === 'fills' ? replaceAt(node.fills, index, shown) : node.fills
    // A stroke keeps its weight and geometry; only its paint changes.
    const strokes =
      list === 'strokes'
        ? node.strokes.map((item, at) =>
            at === index ? { ...pick(item, STROKE_FIELDS), ...shown } : item
          )
        : node.strokes
    nodes.updateNodeWithUndo(nodeId, {
      [list]: list === 'fills' ? fills : strokes,
      pluginData: withShaderPaints(node, [...fills, ...strokes], [shader])
    })
  }

  /**
   * Makes paint `index` of `list` on each of `nodeIds` draw `preset`, as one undo step: a shader
   * paint keeps its image and takes the new preset, any other paint becomes a new shader paint.
   * Frames are drawn once the edit settles.
   */
  function setShaderPaint(
    nodeIds: readonly string[],
    list: ShaderPaintList,
    index: number,
    preset: ShaderPreset
  ): void {
    ctx.undo.beginBatch('Set shader')
    try {
      for (const id of nodeIds) setNodeShader(id, list, index, preset)
    } finally {
      ctx.undo.commitBatch()
    }
  }

  /** Adds a node-local content filter while keeping the source paints and hierarchy editable. */
  function setContentShader(
    nodeIds: readonly string[],
    preset: ShaderPreset = { components: [{ type: 'Pixelate', props: { scale: 24 } }] }
  ): void {
    const targets = nodeIds.map((id) => ctx.graph.getNode(id))
    const overlaps = nodeIds.some((id) =>
      nodeIds.some((other) => id !== other && ctx.graph.isDescendant(id, other))
    )
    if (overlaps || targets.some((node) => !node || !supportsShaderContent(ctx.graph, node))) {
      throw new Error(
        'Content shaders support static images, text and decorative containers without controls, bindings, Motion or generated effects.'
      )
    }
    ctx.undo.beginBatch('Set content shader')
    try {
      for (const node of targets) {
        if (!node) continue
        const existing = readShaderPaints(node).find((shader) => shader.input)
        const created = createShaderPaint(preset)
        const shader = {
          ...(existing ?? created.shader),
          preset: structuredClone(preset),
          input: { kind: 'self' as const, version: 1 as const },
          frame: undefined
        }
        const fills = existing ? node.fills : [...node.fills, created.paint]
        nodes.updateNodeWithUndo(node.id, {
          fills,
          pluginData: withShaderPaints(node, [...fills, ...node.strokes], [shader])
        })
      }
    } finally {
      ctx.undo.commitBatch()
    }
  }

  return { setShaderPaint, setContentShader }
}
