import { expect, mock, test } from 'bun:test'

import type { Image as CKImage } from 'canvaskit-wasm'

import {
  beginDecodedImageCacheFrame,
  cacheDecodedImage,
  clearDecodedImageCache,
  endDecodedImageCacheFrame,
  estimateDecodedImageBytes,
  getDecodedImageCacheEntry,
  type DecodedImageCacheState
} from '#core/canvas/renderer/image-cache'

function image(width = 2, height = 2) {
  return {
    width: () => width,
    height: () => height,
    delete: mock()
  } as CKImage & { delete: ReturnType<typeof mock> }
}

function cacheState(byteBudget: number): DecodedImageCacheState {
  return {
    imageCache: new Map(),
    imageCacheByteSize: 0,
    imageCacheByteBudget: byteBudget,
    imageCacheFrameDepth: 0,
    imageCacheFrameUsed: new Set()
  }
}

test('decoded image byte estimate includes a full RGBA mip chain', () => {
  expect(estimateDecodedImageBytes(image(3, 2))).toBe(32)
})

test('decoded image cache evicts the least recently used unpinned image', () => {
  const state = cacheState(80)
  const first = image()
  const second = image()
  const third = image()

  cacheDecodedImage(state, 'first', first, 40)
  cacheDecodedImage(state, 'second', second, 40)
  expect(getDecodedImageCacheEntry(state, 'first')).toBe(first)
  cacheDecodedImage(state, 'third', third, 40)

  expect([...state.imageCache.keys()]).toEqual(['first', 'third'])
  expect(state.imageCacheByteSize).toBe(80)
  expect(first.delete).not.toHaveBeenCalled()
  expect(second.delete).toHaveBeenCalledTimes(1)
  expect(third.delete).not.toHaveBeenCalled()
})

test('decoded image cache keeps the full working set alive until frame end', () => {
  const state = cacheState(40)
  const first = image()
  const second = image()

  beginDecodedImageCacheFrame(state)
  cacheDecodedImage(state, 'first', first, 32)
  cacheDecodedImage(state, 'second', second, 32)

  expect([...state.imageCache.keys()]).toEqual(['first', 'second'])
  expect(first.delete).not.toHaveBeenCalled()
  expect(second.delete).not.toHaveBeenCalled()

  endDecodedImageCacheFrame(state)

  expect([...state.imageCache.keys()]).toEqual(['second'])
  expect(state.imageCacheByteSize).toBe(32)
  expect(first.delete).toHaveBeenCalledTimes(1)
  expect(second.delete).not.toHaveBeenCalled()
})

test('an oversized decoded image is released when its frame completes', () => {
  const state = cacheState(32)
  const oversized = image()

  beginDecodedImageCacheFrame(state)
  cacheDecodedImage(state, 'oversized', oversized, 96)
  expect(oversized.delete).not.toHaveBeenCalled()

  endDecodedImageCacheFrame(state)

  expect(state.imageCache.size).toBe(0)
  expect(state.imageCacheByteSize).toBe(0)
  expect(oversized.delete).toHaveBeenCalledTimes(1)
})

test('clearing the decoded image cache deletes every owned image and resets frame state', () => {
  const state = cacheState(128)
  const first = image()
  const second = image()
  beginDecodedImageCacheFrame(state)
  cacheDecodedImage(state, 'first', first, 32)
  cacheDecodedImage(state, 'second', second, 32)

  clearDecodedImageCache(state)

  expect(first.delete).toHaveBeenCalledTimes(1)
  expect(second.delete).toHaveBeenCalledTimes(1)
  expect(state.imageCache.size).toBe(0)
  expect(state.imageCacheByteSize).toBe(0)
  expect(state.imageCacheFrameDepth).toBe(0)
  expect(state.imageCacheFrameUsed.size).toBe(0)
})
