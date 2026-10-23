import {
  computeImageHash,
  createShaderPaint,
  withShaderPaints,
  type SceneGraph,
  type SceneNode,
  type ShaderPaint
} from '@open-pencil/scene-graph'

/** Give a mutable output its own name without changing any retained source pixels. */
export function independentShaderImage(node: SceneNode, shader: ShaderPaint) {
  const { image } = createShaderPaint(shader.preset).shader
  const independent = { ...shader, image }
  const fills = node.fills.map((paint) =>
    paint.imageHash === shader.image ? { ...paint, imageHash: image } : paint
  )
  const strokes = node.strokes.map((paint) =>
    paint.imageHash === shader.image ? { ...paint, imageHash: image } : paint
  )
  return {
    shader: independent,
    node: {
      ...node,
      fills,
      strokes,
      pluginData: withShaderPaints(node, [...fills, ...strokes], [independent])
    }
  }
}

/** FIG canonical SHA-1 entries are immutable; successful redraws use a fresh runtime name. */
export function shaderFrameTarget(graph: SceneGraph, node: SceneNode, shader: ShaderPaint) {
  const saved = graph.images.get(shader.image)
  return saved && computeImageHash(saved) === shader.image
    ? independentShaderImage(node, shader)
    : { node, shader }
}
