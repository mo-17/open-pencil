import {
  isShaderFrameCurrent,
  readShaderPaints,
  shaderFramePixels,
  shaderOfPaint,
  shaderPresetKey,
  shaderContentKey,
  contentShader,
  createShaderPaint,
  withShaderPaints,
  type SceneGraph,
  type SceneNode,
  type ShaderPaint
} from '@open-pencil/scene-graph'
import type { Size } from '@open-pencil/scene-graph/primitives'

import type { EditorContext, EditorOptions } from '#core/editor/types'

import { prepareShaderContent, renderShaderContent } from './content'
import { createShaderFrameJob, waitForShaderFrames } from './job'
import type { ShaderRasterizer } from './types'

const SETTLE_MS = 150
const FRAME_TIMEOUT_MS = 10_000
const FRAME_FIELDS = ['fills', 'strokes', 'pluginData', 'width', 'height'] as const

export interface ShaderFramesProgress {
  phase: 'drawing-shaders'
  completed: number
  total: number
}

export interface SettleShaderFramesOptions {
  /** Only these subtrees; omission drains edits already queued, without scanning other pages. */
  nodeIds?: readonly string[]
  signal?: AbortSignal
  /** Exports require a usable current or saved frame; document saves can keep a pending preset. */
  requireFrames?: boolean
}

function shownShaders(node: SceneNode): ShaderPaint[] {
  return [...node.fills, ...node.strokes].flatMap((paint) => {
    const shader = paint.visible && shaderOfPaint(node, paint)
    return shader ? [shader] : []
  })
}

/** Serial, cancellable static frame production; failed attempts retain the saved image. */
export function createShaderFrames(
  ctx: EditorContext,
  options?: Pick<EditorOptions, 'shaderRasterizer'>
) {
  let rasterizer: ShaderRasterizer | null = options?.shaderRasterizer ?? null
  const drawn = new Map<string, string>()
  const failed = new Map<string, string>()
  const pending = new Set<string>()
  const contentOwners = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let drawing: Promise<void> | null = null
  let activeJob: AbortController | null = null
  let publishing = false
  let disposed = false

  function frameKey(node: SceneNode, shader: ShaderPaint): string {
    return JSON.stringify([
      shader.preset,
      Math.round(node.width),
      Math.round(node.height),
      shader.input ? shaderContentKey(ctx.graph, node) : null
    ])
  }

  function isCurrent(node: SceneNode, shader: ShaderPaint): boolean {
    if (!ctx.graph.images.get(shader.image)?.length) return false
    const key = drawn.get(shader.image)
    if (key !== undefined) return key === frameKey(node, shader)
    return (
      isShaderFrameCurrent(shader, node) &&
      (!shader.input || shader.frame?.content === shaderContentKey(ctx.graph, node))
    )
  }

  function schedule(id: string) {
    if (!rasterizer || disposed) return
    pending.add(id)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void drain()
    }, SETTLE_MS)
  }

  function staleOnPage(pageId: string) {
    return [...ctx.graph.getAllNodes()].flatMap((node) =>
      ctx.graph.isDescendant(node.id, pageId)
        ? shownShaders(node)
            .filter((shader) => !isCurrent(node, shader))
            .map((shader) => ({ id: node.id, shader }))
        : []
    )
  }

  function publishFrame(
    now: SceneNode,
    current: ShaderPaint,
    bytes: Uint8Array,
    size: Size,
    key: string
  ) {
    ctx.graph.images.set(current.image, bytes)
    drawn.set(current.image, key)
    failed.delete(current.image)
    for (const target of ctx.getRenderers()) target.forgetImage(current.image)
    publishing = true
    try {
      ctx.graph.updateNode(now.id, {
        pluginData: withShaderPaints(
          now,
          [...now.fills, ...now.strokes],
          [
            {
              ...current,
              frame: {
                ...size,
                preset: shaderPresetKey(current.preset),
                ...(current.input ? { content: shaderContentKey(ctx.graph, now) } : {})
              }
            }
          ]
        )
      })
    } finally {
      publishing = false
    }
    ctx.requestRender()
    invalidateContent(now.parentId)
  }

  async function captureInput(
    node: SceneNode,
    shader: ShaderPaint,
    signal: AbortSignal
  ): Promise<Uint8Array | undefined> {
    if (!shader.input || !(await prepareShaderContent(ctx, node, signal))) return undefined
    const renderer = ctx.getRenderers()[Symbol.iterator]().next().value
    return renderer ? (renderShaderContent(ctx.graph, node, renderer) ?? undefined) : undefined
  }

  function freshFrame(id: string, shader: ShaderPaint, key: string) {
    const node = ctx.graph.getNode(id)
    const current = node && shownShaders(node).find((item) => item.image === shader.image)
    return node && current && frameKey(node, current) === key ? { node, current } : null
  }

  async function renderBytes(
    node: SceneNode,
    shader: ShaderPaint,
    size: Size,
    active: ShaderRasterizer,
    signal: AbortSignal
  ): Promise<Uint8Array | null> {
    const input = await captureInput(node, shader, signal)
    if (signal.aborted || (shader.input && !input)) return null
    return active.render(shader.preset, shaderFramePixels(size), { signal, input })
  }

  function jobIsCurrent(graph: SceneGraph, active: ShaderRasterizer, controller: AbortController) {
    return !controller.signal.aborted && graph === ctx.graph && !disposed && active === rasterizer
  }

  /** Copies may share saved bytes until their node-local content needs an independent output. */
  function independentContentOutput(node: SceneNode, shader: ShaderPaint): ShaderPaint {
    if (!shader.input) return shader
    const shared = [...contentOwners].some((id) => {
      const other = id !== node.id && ctx.graph.getNode(id)
      return other && readShaderPaints(other).some((item) => item.image === shader.image)
    })
    if (!shared) return shader
    const { image } = createShaderPaint(shader.preset).shader
    const independent = { ...shader, image }
    const fills = node.fills.map((fill) =>
      fill.imageHash === shader.image ? { ...fill, imageHash: image } : fill
    )
    const saved = ctx.graph.images.get(shader.image)
    if (saved) ctx.graph.images.set(image, saved)
    publishing = true
    try {
      ctx.graph.updateNode(node.id, {
        fills,
        pluginData: withShaderPaints(node, [...fills, ...node.strokes], [independent])
      })
    } finally {
      publishing = false
    }
    return independent
  }

  async function drawFrame(
    id: string,
    shader: ShaderPaint,
    active: ShaderRasterizer,
    signal?: AbortSignal
  ) {
    const graph = ctx.graph
    const node = graph.getNode(id)
    if (!node || active !== rasterizer || disposed) return
    if (shader.input && !contentShader(graph, node)) return
    shader = independentContentOutput(node, shader)
    const key = frameKey(node, shader)
    if (failed.get(shader.image) === key || isCurrent(node, shader)) return
    const size: Size = { width: node.width, height: node.height }
    const job = createShaderFrameJob(signal)
    const controller = job.controller
    activeJob = controller
    try {
      const bytes = await job.wait(renderBytes(node, shader, size, active, controller.signal))
      if (!jobIsCurrent(graph, active, controller)) return
      const fresh = freshFrame(id, shader, key)
      if (!fresh) return
      if (!bytes?.length) {
        failed.set(shader.image, key)
        return
      }
      publishFrame(fresh.node, fresh.current, bytes, size, key)
    } catch (error) {
      if (graph === ctx.graph && !controller.signal.aborted) {
        failed.set(shader.image, key)
        console.warn('Could not draw a shader frame', error)
      }
    } finally {
      if (job.timedOut()) failed.set(shader.image, key)
      job.close()
      if (activeJob === controller) activeJob = null
    }
  }

  async function drawPending() {
    const deadline = Date.now() + FRAME_TIMEOUT_MS
    while (pending.size > 0 && Date.now() < deadline) {
      const active = rasterizer
      if (!active || disposed) {
        pending.clear()
        return
      }
      const [id] = pending
      pending.delete(id)
      const node = ctx.graph.getNode(id)
      if (!node) continue
      for (const shader of shownShaders(node)) await drawFrame(id, shader, active)
    }
  }

  async function exclusive(work: () => Promise<void>): Promise<void> {
    if (drawing) {
      await drawing
      return exclusive(work)
    }
    drawing = work().finally(() => {
      drawing = null
    })
    await drawing
  }

  async function drain(): Promise<void> {
    // Even when the queue was consumed, its last GPU operation may still be in flight.
    await exclusive(drawPending)
  }

  async function drawPageShaderFrames(
    pageId: string,
    options: {
      signal?: AbortSignal
      onProgress?: (progress: ShaderFramesProgress) => void
    } = {}
  ): Promise<void> {
    const graph = ctx.graph
    const active = rasterizer
    const stale = active ? staleOnPage(pageId) : []
    if (!active || stale.length === 0) return
    const progress = (completed: number) =>
      options.onProgress?.({ phase: 'drawing-shaders', completed, total: stale.length })
    progress(0)
    await exclusive(async () => {
      for (const [index, { id, shader }] of stale.entries()) {
        options.signal?.throwIfAborted()
        if (ctx.graph !== graph) return
        await drawFrame(id, shader, active, options.signal)
        options.signal?.throwIfAborted()
        progress(index + 1)
      }
    })
  }

  function trackContent(node: SceneNode) {
    if (readShaderPaints(node).some((shader) => shader.input)) contentOwners.add(node.id)
    else contentOwners.delete(node.id)
  }
  function resetContentOwners() {
    contentOwners.clear()
    for (const node of ctx.graph.getAllNodes()) trackContent(node)
  }
  resetContentOwners()

  function invalidateContent(id: string | null) {
    if (!id || publishing) return
    for (const ownerId of contentOwners) {
      if (!ctx.graph.isDescendant(id, ownerId)) continue
      const owner = ctx.graph.getNode(ownerId)
      for (const shader of owner ? readShaderPaints(owner) : []) failed.delete(shader.image)
      schedule(ownerId)
    }
  }
  ctx.onEditorEvent('node:created', (node) => {
    trackContent(node)
    if (readShaderPaints(node).length) schedule(node.id)
    invalidateContent(node.id)
  })
  ctx.onEditorEvent('node:updated', (id, changes) => {
    if (publishing) return
    const node = ctx.graph.getNode(id)
    if (node) trackContent(node)
    if (node && FRAME_FIELDS.some((field) => field in changes) && readShaderPaints(node).length) {
      for (const shader of readShaderPaints(node)) failed.delete(shader.image)
      schedule(id)
    }
    invalidateContent(id)
  })
  ctx.onEditorEvent('node:deleted', (id, parentId) => {
    pending.delete(id)
    contentOwners.delete(id)
    invalidateContent(parentId)
  })
  ctx.onEditorEvent('node:reparented', (id, oldParentId) => {
    invalidateContent(id)
    invalidateContent(oldParentId)
  })
  ctx.onEditorEvent('graph:replaced', () => {
    activeJob?.abort()
    resetContentOwners()
    drawn.clear()
    failed.clear()
    pending.clear()
  })

  function setShaderRasterizer(next: ShaderRasterizer | null) {
    if (rasterizer === next) return
    activeJob?.abort()
    rasterizer?.destroy?.()
    rasterizer = next
    failed.clear()
    if (!next) pending.clear()
  }

  async function settleShaderFrames(options: SettleShaderFramesOptions = {}): Promise<void> {
    const graph = ctx.graph
    const targets =
      options.nodeIds &&
      [...graph.getAllNodes()].filter(
        (node) =>
          readShaderPaints(node).length > 0 &&
          options.nodeIds?.some((id) => node.id === id || graph.isDescendant(node.id, id))
      )
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    options.signal?.throwIfAborted()
    for (const node of targets ?? [])
      if (shownShaders(node).some((shader) => !isCurrent(node, shader))) pending.add(node.id)
    await waitForShaderFrames(drain(), options.signal)
    options.signal?.throwIfAborted()
    if (graph !== ctx.graph || disposed)
      throw new Error('Shader frame preparation was superseded by a document change')
    if (pending.size)
      throw new Error('Shader content kept changing during frame preparation; retry after editing')
    if (options.requireFrames) {
      for (const node of targets ?? []) {
        for (const shader of shownShaders(node)) {
          if (shader.input && !contentShader(graph, node)) continue
          if (!graph.images.get(shader.image)?.length)
            throw new Error(`No usable saved Shader frame for layer ${node.name}`)
        }
      }
    }
  }

  function disposeShaderFrames() {
    disposed = true
    if (timer) clearTimeout(timer)
    activeJob?.abort()
    rasterizer?.destroy?.()
    rasterizer = null
    pending.clear()
  }

  return {
    setShaderRasterizer,
    hasShaderRasterizer: () => rasterizer !== null,
    settleShaderFrames,
    drawPageShaderFrames,
    disposeShaderFrames
  }
}
