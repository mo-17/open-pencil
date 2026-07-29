import type { MotionFramePlan } from './types'

export type MotionWebmVideoCodec = 'vp8' | 'vp9'

export interface MotionWebmVideoFrame {
  readonly timestampUs: number
  readonly durationUs: number
  readonly keyFrame: boolean
  readonly bytes: Uint8Array
}

const WEBM_TIMECODE_SCALE_NS = 1_000 // One integer WebM tick is one microsecond.

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function idBytes(id: number): Uint8Array {
  const bytes: number[] = []
  let remaining = id
  do {
    bytes.unshift(remaining & 0xff)
    remaining = Math.floor(remaining / 256)
  } while (remaining > 0)
  return new Uint8Array(bytes)
}

function sizeVint(size: number): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid EBML element size')
  let length = 1
  while (length < 8 && size >= 2 ** (7 * length) - 1) length++
  const bytes = new Uint8Array(length)
  let remaining = BigInt(size)
  for (let index = length - 1; index >= 0; index--) {
    bytes[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  bytes[0] |= 1 << (8 - length)
  return bytes
}

function unsigned(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid EBML unsigned value')
  let remaining = BigInt(value)
  const bytes: number[] = [Number(remaining & 0xffn)]
  while ((remaining >>= 8n) > 0n) bytes.unshift(Number(remaining & 0xffn))
  return new Uint8Array(bytes)
}

function float64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value, false)
  return bytes
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function element(id: number, data: Uint8Array): Uint8Array {
  return concat([idBytes(id), sizeVint(data.length), data])
}

function master(id: number, children: readonly Uint8Array[]): Uint8Array {
  return element(id, concat(children))
}

function simpleBlock(frame: MotionWebmVideoFrame): Uint8Array {
  const header = new Uint8Array([0x81, 0, 0, frame.keyFrame ? 0x80 : 0])
  return element(0xa3, concat([header, frame.bytes]))
}

/**
 * Minimal seek-free WebM muxer for exact Motion timestamps. Each encoded frame starts a cluster,
 * while Segment/Info duration preserves a partial final frame instead of extending it to 1/fps.
 */
export function muxMotionWebm(
  plan: MotionFramePlan,
  frames: readonly MotionWebmVideoFrame[],
  codec: MotionWebmVideoCodec
): Uint8Array {
  if (frames.length !== plan.frameCount) {
    throw new Error(`WebM encoder produced ${frames.length} chunks for ${plan.frameCount} frames`)
  }
  const ordered = [...frames].sort((left, right) => left.timestampUs - right.timestampUs)
  for (let index = 0; index < ordered.length; index++) {
    const planned = plan.frames[index]
    if (
      ordered[index].timestampUs !== planned.timestampUs ||
      ordered[index].durationUs !== planned.durationUs
    ) {
      throw new Error(`WebM chunk ${index} does not match the fixed Motion timebase`)
    }
    if (ordered[index].bytes.length === 0) {
      throw new Error(`WebM chunk ${index} is empty`)
    }
  }

  const ebml = master(0x1a45dfa3, [
    element(0x4286, unsigned(1)),
    element(0x42f7, unsigned(1)),
    element(0x42f2, unsigned(4)),
    element(0x42f3, unsigned(8)),
    element(0x4282, text('webm')),
    element(0x4287, unsigned(4)),
    element(0x4285, unsigned(2))
  ])
  const info = master(0x1549a966, [
    element(0x2ad7b1, unsigned(WEBM_TIMECODE_SCALE_NS)),
    element(0x4489, float64(plan.totalDurationUs)),
    element(0x4d80, text('OpenPencil Motion')),
    element(0x5741, text('OpenPencil Motion'))
  ])
  const video = master(0xe0, [
    element(0xb0, unsigned(plan.pixelWidth)),
    element(0xba, unsigned(plan.pixelHeight))
  ])
  const track = master(0xae, [
    element(0xd7, unsigned(1)),
    element(0x73c5, unsigned(1)),
    element(0x83, unsigned(1)),
    element(0x9c, unsigned(0)),
    element(0x86, text(codec === 'vp9' ? 'V_VP9' : 'V_VP8')),
    element(0x23e383, unsigned(Math.round(1_000_000_000 / plan.fps))),
    video
  ])
  const tracks = master(0x1654ae6b, [track])
  const clusters = ordered.map((frame) =>
    master(0x1f43b675, [element(0xe7, unsigned(frame.timestampUs)), simpleBlock(frame)])
  )
  return concat([ebml, master(0x18538067, [info, tracks, ...clusters])])
}

export function muxVp8Webm(
  plan: MotionFramePlan,
  frames: readonly MotionWebmVideoFrame[]
): Uint8Array {
  return muxMotionWebm(plan, frames, 'vp8')
}
