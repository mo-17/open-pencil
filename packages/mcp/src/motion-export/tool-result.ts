import { Buffer } from 'node:buffer'

import {
  planMotionFrames,
  type MotionAnimationEncoder,
  type MotionExportProgressCallback,
  type MotionFramePlan,
  type MotionRenderedFrame
} from '@open-pencil/core/io/motion-export'

interface JSONRecord {
  [key: string]: unknown
}

function record(value: unknown, label: string): JSONRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Motion ${label} is malformed`)
  }
  return value as JSONRecord
}

function integer(value: unknown, label: string, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) {
    throw new Error(`Motion ${label} is malformed`)
  }
  return value as number
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Motion ${label} is malformed`)
  }
  return value
}

function validBase64(value: unknown, label: string): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`Motion ${label} is malformed`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    throw new Error(`Motion ${label} is malformed`)
  }
  return bytes
}

function assertPNG(bytes: Uint8Array, label: string): void {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < signature.length || !signature.every((byte, index) => bytes[index] === byte)) {
    throw new Error(`Motion ${label} is not valid PNG data`)
  }
}

function reconstructPlan(manifestValue: unknown): MotionFramePlan {
  const manifest = record(manifestValue, 'PNG sequence manifest')
  if (manifest.version !== 1 || manifest.format !== 'png-sequence') {
    throw new Error('Motion PNG sequence manifest uses an unsupported format')
  }
  const fps = integer(manifest.fps, 'manifest fps', 1)
  const loops = integer(manifest.loops, 'manifest loops', 1)
  const sourceDurationUs = integer(manifest.sourceDurationUs, 'manifest source duration', 1)
  const expectedFrameCount = integer(manifest.frameCount, 'manifest frame count', 1)
  const pixelWidth = integer(manifest.pixelWidth, 'manifest pixel width', 1)
  const pixelHeight = integer(manifest.pixelHeight, 'manifest pixel height', 1)
  const width = positiveNumber(manifest.width, 'manifest width')
  const height = positiveNumber(manifest.height, 'manifest height')
  const planned = planMotionFrames({
    durationMs: sourceDurationUs / 1_000,
    fps,
    loops,
    width: pixelWidth,
    height: pixelHeight,
    scale: 1
  })
  if (
    planned.frameCount !== expectedFrameCount ||
    planned.totalDurationUs !== integer(manifest.totalDurationUs, 'manifest total duration', 1)
  ) {
    throw new Error('Motion PNG sequence manifest timing does not match its fixed timebase')
  }
  if (!Array.isArray(manifest.frames) || manifest.frames.length !== planned.frames.length) {
    throw new Error('Motion PNG sequence manifest frame metadata is malformed')
  }
  for (let index = 0; index < planned.frames.length; index++) {
    const candidate = record(manifest.frames[index], `manifest frame ${index}`)
    const frame = planned.frames[index]
    if (
      candidate.index !== frame.index ||
      candidate.file !== frame.fileName ||
      candidate.timestampUs !== frame.timestampUs ||
      candidate.durationUs !== frame.durationUs ||
      candidate.loopIndex !== frame.loopIndex ||
      candidate.localTimeUs !== frame.localTimeUs
    ) {
      throw new Error(`Motion manifest frame ${index} does not match its fixed timebase`)
    }
  }
  return {
    ...planned,
    width,
    height,
    scale: pixelWidth / width,
    pixelWidth,
    pixelHeight
  }
}

function renderedFrames(result: JSONRecord, plan: MotionFramePlan): MotionRenderedFrame[] {
  if (!Array.isArray(result.frames) || result.frames.length !== plan.frameCount) {
    throw new Error('Motion PNG sequence result frame count is malformed')
  }
  let totalBytes = 0
  return result.frames.map((value, index) => {
    const candidate = record(value, `PNG sequence frame ${index}`)
    const planned = plan.frames[index]
    if (candidate.file !== planned.fileName) {
      throw new Error(`Motion PNG sequence frame ${index} has an unexpected file name`)
    }
    const bytes = validBase64(candidate.base64, `PNG sequence frame ${index} base64`)
    assertPNG(bytes, `PNG sequence frame ${index}`)
    if (candidate.byteLength !== undefined && candidate.byteLength !== bytes.length) {
      throw new Error(`Motion PNG sequence frame ${index} length does not match`)
    }
    totalBytes += bytes.length
    if (totalBytes > 512 * 1_024 * 1_024) {
      throw new Error('Motion PNG sequence exceeds the MCP encoded input byte limit')
    }
    return {
      ...planned,
      mimeType: 'image/png',
      bytes: new Uint8Array(bytes),
      byteLength: bytes.length
    }
  })
}

function assertEncodedSignature(format: string, bytes: Uint8Array): void {
  const startsWith = (signature: readonly number[], offset = 0): boolean =>
    signature.every((byte, index) => bytes[offset + index] === byte)
  const valid =
    format === 'webm'
      ? startsWith([0x1a, 0x45, 0xdf, 0xa3])
      : format === 'mp4' && bytes.length >= 12 && startsWith([0x66, 0x74, 0x79, 0x70], 4)
  if (!valid) throw new Error(`Motion ${format} encoder returned an invalid file signature`)
}

/** Convert a bounded app-rendered PNG sequence into a real Node-platform encoded result. */
export async function encodeMotionPNGSequenceToolResult(
  value: unknown,
  encoder: MotionAnimationEncoder,
  signal?: AbortSignal,
  onProgress?: MotionExportProgressCallback
): Promise<Record<string, unknown>> {
  if (encoder.format !== 'webm' && encoder.format !== 'mp4') {
    throw new Error(`MCP platform encoding does not support ${encoder.format}`)
  }
  const result = record(value, 'PNG sequence result')
  if (result.format !== 'png-sequence') {
    throw new Error('MCP platform encoder expected a PNG sequence result')
  }
  const plan = reconstructPlan(result.manifest)
  const frames = renderedFrames(result, plan)
  const bytes = await encoder.encode({ plan, frames, signal, onProgress })
  assertEncodedSignature(encoder.format, bytes)
  return {
    format: encoder.format,
    mimeType: encoder.mimeType,
    extension: encoder.extension,
    base64: Buffer.from(bytes).toString('base64'),
    byteLength: bytes.length,
    encoder: encoder.capability,
    alpha: encoder.alpha ?? 'unknown',
    determinism: encoder.determinism ?? 'timeline-exact',
    issues: Array.isArray(result.issues) ? result.issues : []
  }
}
