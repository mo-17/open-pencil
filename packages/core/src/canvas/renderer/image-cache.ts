import type { Image as CKImage } from 'canvaskit-wasm'

const RGBA_BYTES_PER_PIXEL = 4
const FULL_MIP_CHAIN_FACTOR = 4 / 3

/**
 * Keep renderer-owned decoded-image wrappers bounded independently from the browser's encoded
 * image storage. Recorded SkPictures and retained snapshots may keep native image references alive
 * after a wrapper is evicted; this LRU is therefore a steady-state cache budget, not a hard total
 * GPU-memory ceiling.
 *
 * 128 MiB is large enough to retain a mipmapped 4K RGBA image while staying modest on
 * low-memory machines. Individual images may temporarily exceed the budget for the frame that
 * draws them, but are released when that frame completes.
 */
export const DEFAULT_DECODED_IMAGE_CACHE_BUDGET_BYTES = 128 * 1024 * 1024

export interface DecodedImageCacheEntry {
  readonly image: CKImage
  readonly byteSize: number
}

export interface DecodedImageCacheState {
  imageCache: Map<string, DecodedImageCacheEntry>
  imageCacheByteSize: number
  imageCacheByteBudget: number
  imageCacheFrameDepth: number
  imageCacheFrameUsed: Set<string>
}

function normalizeByteSize(value: number): number {
  if (Number.isNaN(value) || value <= 0) return 0
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(value))
}

/** Conservative RGBA estimate including the full mip chain created by CanvasKit. */
export function estimateDecodedImageBytes(image: Pick<CKImage, 'width' | 'height'>): number {
  const width = normalizeByteSize(image.width())
  const height = normalizeByteSize(image.height())
  return normalizeByteSize(width * height * RGBA_BYTES_PER_PIXEL * FULL_MIP_CHAIN_FACTOR)
}

function removeCachedImage(
  state: DecodedImageCacheState,
  hash: string,
  entry: DecodedImageCacheEntry
): void {
  state.imageCache.delete(hash)
  state.imageCacheByteSize = Math.max(0, state.imageCacheByteSize - entry.byteSize)
  entry.image.delete()
}

function evictToByteSize(state: DecodedImageCacheState, targetByteSize: number): void {
  const target = normalizeByteSize(targetByteSize)
  for (const [hash, entry] of state.imageCache) {
    if (state.imageCacheByteSize <= target) break
    if (state.imageCacheFrameUsed.has(hash)) continue
    removeCachedImage(state, hash, entry)
  }
}

export function beginDecodedImageCacheFrame(state: DecodedImageCacheState): void {
  if (state.imageCacheFrameDepth === 0) state.imageCacheFrameUsed.clear()
  state.imageCacheFrameDepth++
}

export function endDecodedImageCacheFrame(state: DecodedImageCacheState, trim = true): void {
  if (state.imageCacheFrameDepth <= 0) return
  state.imageCacheFrameDepth--
  if (state.imageCacheFrameDepth > 0) return

  // Draw commands have retained their native image references by this point. Unpin before the
  // trim so a one-frame working set larger than the steady-state budget can still be released.
  state.imageCacheFrameUsed.clear()
  if (trim) evictToByteSize(state, state.imageCacheByteBudget)
}

export function getDecodedImageCacheEntry(
  state: DecodedImageCacheState,
  hash: string
): CKImage | undefined {
  const entry = state.imageCache.get(hash)
  if (!entry) return undefined

  // Map insertion order is the LRU order. Refresh a hit without allocating another entry.
  state.imageCache.delete(hash)
  state.imageCache.set(hash, entry)
  if (state.imageCacheFrameDepth > 0) state.imageCacheFrameUsed.add(hash)
  return entry.image
}

/** Free old, unpinned entries before CanvasKit creates another decoded/mipmapped copy. */
export function reserveDecodedImageCacheBytes(
  state: DecodedImageCacheState,
  byteSize: number
): void {
  const budget = normalizeByteSize(state.imageCacheByteBudget)
  const requested = normalizeByteSize(byteSize)
  evictToByteSize(state, Math.max(0, budget - requested))
}

export function cacheDecodedImage(
  state: DecodedImageCacheState,
  hash: string,
  image: CKImage,
  byteSize = estimateDecodedImageBytes(image)
): void {
  const normalizedSize = normalizeByteSize(byteSize)
  const previous = state.imageCache.get(hash)
  if (previous) {
    state.imageCache.delete(hash)
    state.imageCacheByteSize = Math.max(0, state.imageCacheByteSize - previous.byteSize)
    if (previous.image !== image) previous.image.delete()
  }

  reserveDecodedImageCacheBytes(state, normalizedSize)
  state.imageCache.set(hash, { image, byteSize: normalizedSize })
  state.imageCacheByteSize += normalizedSize
  if (state.imageCacheFrameDepth > 0) state.imageCacheFrameUsed.add(hash)
}

export function clearDecodedImageCache(state: DecodedImageCacheState): void {
  for (const entry of state.imageCache.values()) entry.image.delete()
  state.imageCache.clear()
  state.imageCacheByteSize = 0
  state.imageCacheFrameDepth = 0
  state.imageCacheFrameUsed.clear()
}
