import type { SceneNode } from '@open-pencil/scene-graph'

import { abortError, isAbortError, throwIfAborted } from '#core/async-work'
import type { FigmaAPI } from '#core/figma-api'

import type { StockPhotoProvider, StockPhotoResult } from './providers'

const STOCK_PHOTO_ABORT_MESSAGE = 'Stock photo request cancelled'
const STOCK_PHOTO_TARGET_TYPES: ReadonlySet<SceneNode['type']> = new Set([
  'FRAME',
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'STAR',
  'POLYGON',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'COMPONENT',
  'INSTANCE'
])

export interface PhotoRequest {
  id: string
  query: string
  index?: number
  orientation?: 'landscape' | 'portrait' | 'square'
}

export interface PhotoResult {
  id: string
  photo?: {
    sourceId: string
    photographer: string
    width: number
    height: number
    provider: string
  }
  error?: string
}

export async function applyPhoto(
  figma: FigmaAPI,
  provider: StockPhotoProvider,
  req: PhotoRequest,
  signal?: AbortSignal
): Promise<PhotoResult> {
  throwIfAborted(signal, STOCK_PHOTO_ABORT_MESSAGE)
  const node = figma.getNodeById(req.id)
  if (!node) return { id: req.id, error: 'Not found' }

  if (!STOCK_PHOTO_TARGET_TYPES.has(node.type)) {
    return {
      id: req.id,
      error: `"${node.name}" (${node.type}) is not a suitable stock photo target`
    }
  }

  if (node.type === 'VECTOR' && (node.vectorNetwork.regions?.length ?? 0) === 0) {
    return {
      id: req.id,
      error: `"${node.name}" has no closed vector regions — use closed area geometry`
    }
  }

  if (node.type !== 'BOOLEAN_OPERATION' && node.children.length > 0) {
    return { id: req.id, error: `"${node.name}" has children — use a leaf image placeholder` }
  }

  const perPage = Math.min((req.index ?? 0) + 3, 15)
  const orientation = req.orientation ?? 'landscape'
  const targetDim = Math.max(node.width, node.height)

  let results: StockPhotoResult[]
  try {
    results = await provider.search(req.query, { perPage, orientation, targetDim, signal })
  } catch (err) {
    if (isAbortError(err, signal)) throw abortError(STOCK_PHOTO_ABORT_MESSAGE)
    return { id: req.id, error: err instanceof Error ? err.message : String(err) }
  }
  throwIfAborted(signal, STOCK_PHOTO_ABORT_MESSAGE)

  if (results.length === 0) return { id: req.id, error: `No photos for "${req.query}"` }
  const photo = results[Math.min(req.index ?? 0, results.length - 1)]

  let imageBytes: Uint8Array
  try {
    const response = await fetch(photo.url, { signal })
    if (!response.ok) return { id: req.id, error: `Download ${response.status}` }
    imageBytes = new Uint8Array(await response.arrayBuffer())
  } catch (err) {
    if (isAbortError(err, signal)) throw abortError(STOCK_PHOTO_ABORT_MESSAGE)
    return { id: req.id, error: `Download: ${err instanceof Error ? err.message : String(err)}` }
  }
  throwIfAborted(signal, STOCK_PHOTO_ABORT_MESSAGE)

  const image = figma.createImage(imageBytes)
  node.fills = [
    {
      type: 'IMAGE',
      color: { r: 1, g: 1, b: 1, a: 1 },
      imageHash: image.hash,
      imageScaleMode: 'FILL',
      visible: true,
      opacity: 1
    }
  ]

  return {
    id: node.id,
    photo: {
      sourceId: photo.sourceId,
      photographer: photo.photographer,
      width: photo.width,
      height: photo.height,
      provider: provider.name
    }
  }
}
