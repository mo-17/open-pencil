import {
  AI_VISUAL_COMPARE_VIEWPORTS,
  type AIVisualArtifact,
  type AIVisualCaptureBackend,
  type AIVisualCaptureRequest,
  type AIVisualCompareRequest,
  type AIVisualComparator,
  type AIVisualViewport
} from '@open-pencil/core/ai-draft'
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import { computeAllLayoutsAsync } from '@open-pencil/core/layout'
import { inspectImageBytes, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

const MAX_REFERENCE_BYTES = 8 * 1024 * 1024
const MAX_FRAME_SCAN_NODES = 20_000

function throwIfAborted(signal: AbortSignal): void {
  signal.throwIfAborted()
}

function frameDimensions(node: SceneNode): { width: number; height: number } | null {
  const width = node.width
  const height = node.height
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width: Math.round(width), height: Math.round(height) }
}

function isViewportFrame(node: SceneNode, viewport: AIVisualViewport): boolean {
  if (!node.visible || (node.type !== 'FRAME' && node.type !== 'COMPONENT')) return false
  const dimensions = frameDimensions(node)
  return dimensions?.width === viewport.width && dimensions.height === viewport.height
}

function frameScore(node: SceneNode, viewport: AIVisualViewport): number {
  const name = node.name.toLowerCase()
  let score = 0
  if (name.includes(viewport.id)) score += 4
  if (name.includes(`${viewport.width}`) && name.includes(`${viewport.height}`)) score += 2
  if (node.parentId && node.type === 'FRAME') score += 1
  return score
}

function viewportFrame(graph: SceneGraph, pageId: string, viewport: AIVisualViewport): SceneNode {
  const page = graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error('Shadow draft page is unavailable.')
  const queue = [...page.childIds]
  const matches: SceneNode[] = []
  let scanned = 0
  while (queue.length > 0) {
    if (++scanned > MAX_FRAME_SCAN_NODES) {
      throw new Error(`Shadow draft exceeds the ${MAX_FRAME_SCAN_NODES} node capture scan limit.`)
    }
    const id = queue.shift()
    if (!id) continue
    const node = graph.getNode(id)
    if (!node) continue
    if (isViewportFrame(node, viewport)) matches.push(node)
    queue.push(...node.childIds)
  }
  matches.sort((left, right) => frameScore(right, viewport) - frameScore(left, viewport))
  const first = matches.at(0)
  if (!first) {
    throw new Error(
      `Shadow draft must contain a visible ${viewport.width}×${viewport.height} Frame for ${viewport.id}.`
    )
  }
  const second = matches.at(1)
  if (second && frameScore(second, viewport) === frameScore(first, viewport)) {
    throw new Error(
      `Shadow draft contains ambiguous ${viewport.width}×${viewport.height} Frames; name one with “${viewport.id}”.`
    )
  }
  return first
}

function exactFrameBounds(graph: SceneGraph, node: SceneNode) {
  const position = graph.getAbsolutePosition(node.id)
  return {
    minX: position.x,
    minY: position.y,
    maxX: position.x + node.width,
    maxY: position.y + node.height
  }
}

export function createCodePenShadowCaptureBackend(store: EditorStore): AIVisualCaptureBackend {
  return Object.freeze({
    async capture({
      graph,
      pageId,
      viewport,
      signal
    }: AIVisualCaptureRequest): Promise<AIVisualArtifact> {
      throwIfAborted(signal)
      const renderer = store.renderer
      if (!renderer) throw new Error('Canvas renderer is unavailable for visual comparison.')
      await computeAllLayoutsAsync(graph, pageId, signal)
      throwIfAborted(signal)
      const frame = viewportFrame(graph, pageId, viewport)
      const bytes = renderNodesToImage(renderer.ck, renderer, graph, pageId, [frame.id], {
        scale: 1,
        format: 'PNG',
        bounds: exactFrameBounds(graph, frame),
        trimTransparent: false
      })
      if (!bytes) throw new Error(`Unable to render the ${viewport.id} shadow frame.`)
      return {
        mediaType: 'image/png',
        bytes,
        width: viewport.width,
        height: viewport.height
      }
    }
  })
}

function fixedViewport(value: unknown): AIVisualViewport {
  if (!value || typeof value !== 'object') {
    throw new Error('Unsupported visual comparison viewport.')
  }
  const candidate = value as Partial<AIVisualViewport>
  const viewport = AI_VISUAL_COMPARE_VIEWPORTS.find(
    ({ id, width, height }) =>
      candidate.id === id && candidate.width === width && candidate.height === height
  )
  if (!viewport) throw new Error('Unsupported visual comparison viewport.')
  return viewport
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

/**
 * Takes an owned byte snapshot and rejects untrusted image data before browser decoding.
 * The encoded dimensions must match one of the three fixed comparison viewports exactly.
 */
export function preflightCodePenVisualArtifact(
  value: unknown,
  viewportValue: unknown
): AIVisualArtifact {
  const viewport = fixedViewport(viewportValue)
  if (!value || typeof value !== 'object') {
    throw new Error('Visual artifact metadata is invalid.')
  }
  const artifact = value as Partial<AIVisualArtifact>
  if (
    (artifact.mediaType !== 'image/png' && artifact.mediaType !== 'image/webp') ||
    !(artifact.bytes instanceof Uint8Array) ||
    artifact.bytes.byteLength === 0 ||
    artifact.bytes.byteLength > MAX_REFERENCE_BYTES ||
    artifact.width !== viewport.width ||
    artifact.height !== viewport.height
  ) {
    throw new Error('Visual artifact metadata does not match its fixed viewport.')
  }

  const bytes = artifact.bytes.slice()
  const inspection = inspectImageBytes(bytes)
  if (
    inspection.headerValidation !== 'valid' ||
    inspection.dimensionStatus !== 'parsed' ||
    !inspection.dimensions
  ) {
    throw new Error('Visual artifact must contain a complete PNG or WebP header.')
  }
  if (inspection.mimeType !== artifact.mediaType) {
    throw new Error('Visual artifact media type does not match its encoded bytes.')
  }

  const { width, height } = inspection.dimensions
  const pixels = width * height
  const pixelBudget = viewport.width * viewport.height
  if (!Number.isSafeInteger(pixels) || pixels > pixelBudget) {
    throw new Error(`${viewport.id} visual artifact exceeds its ${pixelBudget} pixel budget.`)
  }
  if (width !== viewport.width || height !== viewport.height) {
    throw new Error(
      `${viewport.id} visual artifact must be exactly ${viewport.width}×${viewport.height} pixels.`
    )
  }

  return Object.freeze({
    mediaType: artifact.mediaType,
    bytes,
    width: viewport.width,
    height: viewport.height
  })
}

async function decodeArtifact(
  artifact: AIVisualArtifact,
  viewport: AIVisualViewport
): Promise<Uint8ClampedArray> {
  const validated = preflightCodePenVisualArtifact(artifact, viewport)
  const blob = new Blob([copyToArrayBuffer(validated.bytes)], { type: validated.mediaType })
  const bitmap = await createImageBitmap(blob)
  try {
    if (bitmap.width !== viewport.width || bitmap.height !== viewport.height) {
      throw new Error('Decoded visual artifact dimensions do not match its fixed viewport.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('A 2D canvas is required for visual comparison.')
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data
  } finally {
    bitmap.close()
  }
}

export function compareCodePenRGBA(
  reference: Uint8ClampedArray,
  candidate: Uint8ClampedArray
): number {
  if (reference.byteLength === 0 || reference.byteLength !== candidate.byteLength) {
    throw new Error('Visual pixel buffers must be non-empty and have equal length.')
  }
  let difference = 0
  for (let index = 0; index < reference.byteLength; index++) {
    difference += Math.abs(reference[index] - candidate[index])
  }
  return difference / (reference.byteLength * 255)
}

export const codePenPixelComparator: AIVisualComparator = Object.freeze({
  async compare({ reference, candidate, viewport, signal }: AIVisualCompareRequest) {
    throwIfAborted(signal)
    const [referencePixels, candidatePixels] = await Promise.all([
      decodeArtifact(reference, viewport),
      decodeArtifact(candidate, viewport)
    ])
    throwIfAborted(signal)
    return { differenceRatio: compareCodePenRGBA(referencePixels, candidatePixels) }
  }
})

function mediaTypeForFile(file: File): AIVisualArtifact['mediaType'] {
  if (file.type === 'image/png') return 'image/png'
  if (file.type === 'image/webp') return 'image/webp'
  throw new Error('Visual references must be PNG or WebP files.')
}

export async function readCodePenVisualReference(
  file: File,
  viewportId: AIVisualViewport['id']
): Promise<AIVisualArtifact> {
  const viewport = AI_VISUAL_COMPARE_VIEWPORTS.find(({ id }) => id === viewportId)
  if (!viewport) throw new Error('Unsupported visual reference viewport.')
  if (file.size <= 0 || file.size > MAX_REFERENCE_BYTES) {
    throw new Error(`Visual references may not exceed ${MAX_REFERENCE_BYTES} bytes each.`)
  }
  const mediaType = mediaTypeForFile(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const artifact = preflightCodePenVisualArtifact(
    { mediaType, bytes, width: viewport.width, height: viewport.height },
    viewport
  )
  const bitmap = await createImageBitmap(
    new Blob([copyToArrayBuffer(artifact.bytes)], { type: artifact.mediaType })
  )
  try {
    if (bitmap.width !== viewport.width || bitmap.height !== viewport.height) {
      throw new Error(
        `${viewport.id} reference must be exactly ${viewport.width}×${viewport.height} pixels.`
      )
    }
  } finally {
    bitmap.close()
  }
  return artifact
}
