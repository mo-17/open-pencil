import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { VR_TOUR_COPY_SOURCE } from '#compiler/adapters/vr-tour/copy'
import { VR_TOUR_IMAGE_HEADER_SOURCE } from '#compiler/adapters/vr-tour/image-header'

const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  VR_TOUR_COPY_SOURCE + VR_TOUR_IMAGE_HEADER_SOURCE
)
const directory = mkdtempSync(join(tmpdir(), 'openpencil-vr-header-'))
const modulePath = join(directory, 'header.mjs')
writeFileSync(modulePath, source)
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const { panoramaDimensions } = await import(pathToFileURL(modulePath).href)

function png(width: number, height: number) {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set(new TextEncoder().encode('IHDR'), 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

test('pre-decode header guard rejects oversized, non-equirectangular and malformed compressed images', () => {
  expect(panoramaDimensions(png(1024, 512), 'image/png')).toEqual([1024, 512])
  for (const [width, height] of [
    [100000, 50000],
    [1024, 513],
    [0, 0],
    [256, 128]
  ]) {
    expect(() => panoramaDimensions(png(width, height), 'image/png')).toThrow('2:1')
  }
  expect(() => panoramaDimensions(png(1024, 512), 'image/jpeg')).toThrow('2:1')
  expect(() => panoramaDimensions(new Uint8Array(), 'image/png')).toThrow('2:1')
})

test('JPEG and WebP sizes are read before browser decode with bounded segment traversal', () => {
  const jpeg = new Uint8Array([255, 216, 255, 192, 0, 7, 8, 2, 0, 4, 0])
  expect(panoramaDimensions(jpeg, 'image/jpeg')).toEqual([1024, 512])
  const webp = new Uint8Array(30)
  webp.set(new TextEncoder().encode('RIFF'), 0)
  new DataView(webp.buffer).setUint32(4, 22, true)
  webp.set(new TextEncoder().encode('WEBPVP8X'), 8)
  new DataView(webp.buffer).setUint32(16, 10, true)
  webp.set([255, 3, 0, 255, 1, 0], 24)
  expect(panoramaDimensions(webp, 'image/webp')).toEqual([1024, 512])
  webp[20] = 2
  expect(() => panoramaDimensions(webp, 'image/webp')).toThrow('2:1')
  const bomb = new Uint8Array(2 * 1024 * 1024).fill(255)
  bomb.set([255, 216, 255])
  expect(() => panoramaDimensions(bomb, 'image/jpeg')).toThrow('2:1')
})
