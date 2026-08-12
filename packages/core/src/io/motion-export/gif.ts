import { getCanvasKit } from '#core/canvaskit'

import {
  MotionExportCancelledError,
  type MotionAnimationEncoder,
  type MotionAnimationEncoderInput
} from './types'

const GIF_MAX_FPS = 100
const TRANSPARENT_ALPHA_THRESHOLD = 128
const GIF_PALETTE_SIZE = 256
const GIF_LZW_MIN_CODE_SIZE = 8

class ByteWriter {
  #bytes: Uint8Array
  #length = 0

  constructor(capacity = 4_096) {
    this.#bytes = new Uint8Array(capacity)
  }

  get length(): number {
    return this.#length
  }

  byte(value: number): void {
    this.#ensure(1)
    this.#bytes[this.#length++] = value & 0xff
  }

  uint16(value: number): void {
    this.byte(value)
    this.byte(value >>> 8)
  }

  ascii(value: string): void {
    this.bytes(new TextEncoder().encode(value))
  }

  bytes(value: Uint8Array): void {
    this.#ensure(value.length)
    this.#bytes.set(value, this.#length)
    this.#length += value.length
  }

  finish(): Uint8Array {
    return this.#bytes.slice(0, this.#length)
  }

  #ensure(extra: number): void {
    const required = this.#length + extra
    if (required <= this.#bytes.length) return
    let capacity = this.#bytes.length
    while (capacity < required) capacity = Math.max(capacity * 2, required)
    const grown = new Uint8Array(capacity)
    grown.set(this.#bytes)
    this.#bytes = grown
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new MotionExportCancelledError()
}

/** A stable 3-3-2 RGB palette. Index zero is also the optional transparency index. */
function fixedPalette(): Uint8Array {
  const palette = new Uint8Array(GIF_PALETTE_SIZE * 3)
  for (let index = 0; index < GIF_PALETTE_SIZE; index++) {
    const red = (index >>> 5) & 0x07
    const green = (index >>> 2) & 0x07
    const blue = index & 0x03
    palette[index * 3] = Math.round((red * 255) / 7)
    palette[index * 3 + 1] = Math.round((green * 255) / 7)
    palette[index * 3 + 2] = Math.round((blue * 255) / 3)
  }
  return palette
}

function paletteIndex(red: number, green: number, blue: number): number {
  const index = (red & 0xe0) | ((green & 0xe0) >>> 3) | (blue >>> 6)
  // Index zero is reserved whenever a frame has transparent pixels. Mapping
  // opaque near-black to the next palette entry avoids turning it transparent.
  return index === 0 ? 1 : index
}

interface IndexedFrame {
  readonly indices: Uint8Array
  readonly hasTransparency: boolean
}

function indexPixels(pixels: Uint8Array): IndexedFrame {
  const indices = new Uint8Array(pixels.length / 4)
  let hasTransparency = false
  for (let offset = 0, pixel = 0; offset < pixels.length; offset += 4, pixel++) {
    if (pixels[offset + 3] < TRANSPARENT_ALPHA_THRESHOLD) {
      indices[pixel] = 0
      hasTransparency = true
    } else {
      indices[pixel] = paletteIndex(pixels[offset], pixels[offset + 1], pixels[offset + 2])
    }
  }
  return { indices, hasTransparency }
}

function writeCode(
  output: ByteWriter,
  state: { bitBuffer: number; bitCount: number },
  code: number,
  codeSize: number
): void {
  state.bitBuffer |= code << state.bitCount
  state.bitCount += codeSize
  while (state.bitCount >= 8) {
    output.byte(state.bitBuffer)
    state.bitBuffer >>>= 8
    state.bitCount -= 8
  }
}

function lzwEncode(indices: Uint8Array): Uint8Array {
  const clearCode = 1 << GIF_LZW_MIN_CODE_SIZE
  const endCode = clearCode + 1
  const output = new ByteWriter(Math.max(512, Math.ceil(indices.length / 2)))
  const bits = { bitBuffer: 0, bitCount: 0 }
  let dictionary = new Map<number, number>()
  let nextCode = endCode + 1
  let codeSize = GIF_LZW_MIN_CODE_SIZE + 1

  const reset = (): void => {
    dictionary = new Map()
    nextCode = endCode + 1
    codeSize = GIF_LZW_MIN_CODE_SIZE + 1
  }

  writeCode(output, bits, clearCode, codeSize)
  let prefix = indices[0]
  for (let index = 1; index < indices.length; index++) {
    const suffix = indices[index]
    const key = prefix * 256 + suffix
    const existing = dictionary.get(key)
    if (existing !== undefined) {
      prefix = existing
      continue
    }

    writeCode(output, bits, prefix, codeSize)
    if (nextCode < 4_096) {
      dictionary.set(key, nextCode++)
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize++
    } else {
      writeCode(output, bits, clearCode, codeSize)
      reset()
    }
    prefix = suffix
  }
  writeCode(output, bits, prefix, codeSize)
  writeCode(output, bits, endCode, codeSize)
  if (bits.bitCount > 0) output.byte(bits.bitBuffer)
  return output.finish()
}

function writeSubBlocks(output: ByteWriter, bytes: Uint8Array): void {
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const length = Math.min(255, bytes.length - offset)
    output.byte(length)
    output.bytes(bytes.subarray(offset, offset + length))
  }
  output.byte(0)
}

function frameDelayCentiseconds(input: MotionAnimationEncoderInput, frameIndex: number): number {
  const frame = input.plan.frames[frameIndex]
  const start = Math.round(frame.timestampUs / 10_000)
  const end = Math.round((frame.timestampUs + frame.durationUs) / 10_000)
  return Math.max(1, end - start)
}

async function decodePNGFrame(
  bytes: Uint8Array,
  width: number,
  height: number
): Promise<IndexedFrame> {
  const ck = await getCanvasKit()
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) throw new Error('GIF encoder could not decode a rendered PNG frame')
  try {
    if (image.width() !== width || image.height() !== height) {
      throw new Error(
        `GIF frame size ${image.width()}x${image.height()} does not match ${width}x${height}`
      )
    }
    const pixels = image.readPixels(0, 0, {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB
    })
    if (!(pixels instanceof Uint8Array)) throw new Error('GIF encoder could not read RGBA pixels')
    return indexPixels(pixels)
  } finally {
    image.delete()
  }
}

async function encodeGif(input: MotionAnimationEncoderInput): Promise<Uint8Array> {
  if (input.plan.fps > GIF_MAX_FPS) {
    throw new Error(`GIF export supports at most ${GIF_MAX_FPS} fps (10 ms GIF timebase)`)
  }
  const { pixelWidth: width, pixelHeight: height } = input.plan
  const output = new ByteWriter()
  output.ascii('GIF89a')
  output.uint16(width)
  output.uint16(height)
  output.byte(0xf7) // Global 256-entry color table, 8-bit color resolution.
  output.byte(0)
  output.byte(0)
  output.bytes(fixedPalette())

  for (let frameIndex = 0; frameIndex < input.frames.length; frameIndex++) {
    throwIfCancelled(input.signal)
    const indexed = await decodePNGFrame(input.frames[frameIndex].bytes, width, height)
    throwIfCancelled(input.signal)

    output.bytes(new Uint8Array([0x21, 0xf9, 0x04]))
    // Restore-to-background disposal prevents transparent pixels retaining the previous frame.
    output.byte((2 << 2) | (indexed.hasTransparency ? 1 : 0))
    output.uint16(frameDelayCentiseconds(input, frameIndex))
    output.byte(0)
    output.byte(0)

    output.byte(0x2c)
    output.uint16(0)
    output.uint16(0)
    output.uint16(width)
    output.uint16(height)
    output.byte(0)
    output.byte(GIF_LZW_MIN_CODE_SIZE)
    writeSubBlocks(output, lzwEncode(indexed.indices))
    input.onProgress?.({
      phase: 'encode',
      completed: frameIndex + 1,
      total: input.frames.length,
      frameIndex
    })
  }

  output.byte(0x3b)
  return output.finish()
}

/**
 * Cross-platform deterministic GIF89a encoder.
 *
 * It intentionally uses a fixed 3-3-2 palette instead of an adaptive palette:
 * bytes stay reproducible across runtimes, at the cost of photographic color quality.
 * Alpha values below 128 use GIF's one-bit transparency index.
 */
export const builtinGifMotionEncoder: MotionAnimationEncoder = Object.freeze({
  format: 'gif',
  mimeType: 'image/gif',
  extension: 'gif',
  capability: 'builtin GIF89a (fixed 3-3-2 palette, alpha threshold 128)',
  alpha: 'binary-threshold',
  determinism: 'bit-exact',
  encode: encodeGif
})

export const BUILTIN_MOTION_ANIMATION_ENCODERS: readonly MotionAnimationEncoder[] = Object.freeze([
  builtinGifMotionEncoder
])
