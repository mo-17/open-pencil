import { describe, expect, test } from 'bun:test'

import {
  createShaderPaint,
  SceneGraph,
  withShaderPaints,
  type Fill,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  inspectExportReadiness,
  requireExportReadiness
} from '@/app/document/export/preflight/inspect'

function missingImage(imageHash = 'missing-source'): Fill {
  return {
    type: 'IMAGE',
    imageHash,
    imageScaleMode: 'FILL',
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity: 1,
    visible: true
  }
}

function shaderNode(
  graph: SceneGraph,
  options: {
    self?: boolean
    saved?: boolean
    source?: boolean
    parentId?: string
  } = {}
) {
  const { paint, shader: original } = createShaderPaint({
    components: [{ type: 'Pixelate', props: { scale: 8 } }]
  })
  const shader = options.self
    ? { ...original, input: { kind: 'self' as const, version: 1 as const } }
    : original
  const fills = options.source ? [missingImage(), paint] : [paint]
  const node = graph.createNode('FRAME', options.parentId ?? graph.getPages()[0].id, {
    name: 'Filtered decoration',
    width: 80,
    height: 60,
    fills
  })
  graph.updateNode(node.id, { pluginData: withShaderPaints(node, fills, [shader]) })
  // Simulated encoded output: these tests inspect readiness, not GPU or image decoding.
  if (options.saved) graph.images.set(shader.image, new Uint8Array([1, 2, 3]))
  return { node, shader }
}

function report(
  graph: SceneGraph,
  roots: readonly string[],
  format = 'png',
  canRenderShaders = false
) {
  return inspectExportReadiness(graph, roots, { format, canRenderShaders })
}

describe('export preflight contracts', () => {
  test('missing authored images block visual export but remain warnings for editable FIG copies', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, { fills: [missingImage()] })
    const visual = report(graph, [node.id])
    expect(visual.issues).toEqual([
      expect.objectContaining({ code: 'missing-image', severity: 'error', nodeId: node.id })
    ])
    expect(visual.blockingCount).toBe(1)
    expect(() => requireExportReadiness(visual)).toThrow('Export preflight failed')
    const editable = report(graph, [node.id], 'fig')
    expect(editable.issues).toEqual([
      expect.objectContaining({ code: 'missing-image', severity: 'warning' })
    ])
    expect(editable.blockingCount).toBe(0)
    expect(() => requireExportReadiness(editable)).not.toThrow()
  })

  test('saved own-content output bypasses missing source paints and flattened descendants', () => {
    const graph = new SceneGraph()
    const { node } = shaderNode(graph, { self: true, saved: true, source: true })
    const child = graph.createNode('RECTANGLE', node.id, { fills: [missingImage('missing-child')] })
    const authored = structuredClone(node)
    for (const format of ['png', 'React']) {
      const visual = report(graph, [node.id], format)
      expect(visual.nodeCount).toBe(1)
      expect(visual.issues).toEqual([
        expect.objectContaining({ code: 'shader-static', severity: 'info', nodeId: node.id })
      ])
      expect(() => requireExportReadiness(visual)).not.toThrow()
    }
    const editable = report(graph, [node.id], 'fig')
    expect(editable.nodeCount).toBe(2)
    expect(editable.issues.filter((issue) => issue.code === 'missing-image')).toHaveLength(2)
    expect(editable.blockingCount).toBe(0)
    expect(node).toEqual(authored)
    expect(graph.getNode(child.id)).toBe(child)
  })

  test('unsupported own-content filters preserve authored interactive controls without requiring a Shader frame', () => {
    const graph = new SceneGraph()
    const { node } = shaderNode(graph, { self: true })
    const control = graph.createNode('BUTTON', node.id, { name: 'Live action', text: 'Keep me' })
    const authored = structuredClone(control)
    const result = report(graph, [node.id], 'Vue')
    expect(result.nodeCount).toBe(2)
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'shader-unsupported', severity: 'warning', nodeId: node.id })
    ])
    expect(result.blockingCount).toBe(0)
    expect(() => requireExportReadiness(result)).not.toThrow()
    expect(graph.getNode(control.id)).toBe(control)
    expect(control).toEqual(authored)
  })

  test('missing Shader output distinguishes a render-capable host from a required saved fallback', () => {
    const graph = new SceneGraph()
    const { node } = shaderNode(graph)
    const pending = report(graph, [node.id], 'png', true)
    expect(pending.issues).toEqual([
      expect.objectContaining({ code: 'shader-pending', severity: 'warning' })
    ])
    expect(pending.blockingCount).toBe(0)
    const missing = report(graph, [node.id])
    expect(missing.issues).toEqual([
      expect.objectContaining({ code: 'shader-missing', severity: 'error' })
    ])
    expect(() => requireExportReadiness(missing)).toThrow('shader-missing')
    const editable = report(graph, [node.id], 'fig')
    expect(editable.issues[0]?.severity).toBe('warning')
    expect(() => requireExportReadiness(editable)).not.toThrow()
  })

  test('an existing saved frame remains exportable after a rendering failure', () => {
    const graph = new SceneGraph()
    const { node } = shaderNode(graph, { saved: true })
    const result = inspectExportReadiness(graph, [node.id], {
      format: 'png',
      shaderStatus: () => ({
        phase: 'saved',
        reason: 'failed',
        hasSavedFrame: true,
        canRetry: false
      })
    })
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'shader-stale', severity: 'warning' })
    ])
    expect(() => requireExportReadiness(result)).not.toThrow()
  })

  test('selection checks exclude unrelated siblings and do not count overlapping roots twice', () => {
    const graph = new SceneGraph()
    const frame = graph.createNode('FRAME', graph.getPages()[0].id)
    const child = graph.createNode('RECTANGLE', frame.id)
    graph.createNode('RECTANGLE', graph.getPages()[0].id, { fills: [missingImage()] })
    const result = report(graph, [frame.id, child.id, frame.id])
    expect(result.nodeCount).toBe(2)
    expect(result.issues).toEqual([])
  })

  test('hidden subtrees and invisible paints do not block a visual target', () => {
    const graph = new SceneGraph()
    const frame = graph.createNode('FRAME', graph.getPages()[0].id)
    const hidden = graph.createNode('FRAME', frame.id, { visible: false })
    graph.createNode('RECTANGLE', hidden.id, { fills: [missingImage()] })
    const transparent = missingImage()
    transparent.opacity = 0
    const invisible = missingImage('invisible')
    invisible.visible = false
    graph.createNode('RECTANGLE', frame.id, { fills: [transparent, invisible] })
    expect(report(graph, [frame.id]).issues).toEqual([])
  })

  test('a blocking issue beyond the displayed report limit still prevents export', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    for (let i = 0; i < 100; i++) shaderNode(graph, { self: true, saved: true })
    const missing = graph.createNode('RECTANGLE', page.id, { fills: [missingImage()] })
    const result = report(graph, [page.id])
    expect(result.issues).toHaveLength(100)
    expect(result.issues.every((issue) => issue.severity === 'info')).toBe(true)
    expect(result.issues.some((issue) => issue.nodeId === missing.id)).toBe(false)
    expect(result.truncated).toBe(true)
    expect(result.blockingCount).toBe(1)
    expect(() => requireExportReadiness(result)).toThrow('Export preflight failed (1)')
  })

  test('a large dangling child list is bounded without spreading it onto the call stack', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    // No large scene allocation: only invalid references exercise the traversal work budget.
    const childIds = Array.from({ length: 15_000 }, (_, index) => `missing-${index}`)
    graph.updateNode(page.id, { childIds } satisfies Partial<SceneNode>)
    const result = report(graph, [page.id])
    expect(result.nodeCount).toBe(1)
    expect(result.truncated).toBe(true)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'scan-limit' }))
  })
})
