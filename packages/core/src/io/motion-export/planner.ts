import {
  MOTION_EXPORT_LIMITS,
  type MotionFramePlan,
  type MotionPlannedFrame,
  type PlanMotionFramesOptions
} from './types'

function finitePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero`)
  }
  return value
}

function boundedInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

/**
 * Build an accumulation-free frame schedule. Authored milliseconds are quantized once to integer
 * microseconds and every timestamp is then derived from its integer frame index.
 */
export function planMotionFrames(options: PlanMotionFramesOptions): MotionFramePlan {
  const fps = boundedInteger(
    'fps',
    options.fps ?? 30,
    MOTION_EXPORT_LIMITS.minFps,
    MOTION_EXPORT_LIMITS.maxFps
  )
  const loops = boundedInteger('loops', options.loops ?? 1, 1, MOTION_EXPORT_LIMITS.maxLoops)
  const scale = finitePositive('scale', options.scale ?? 1)
  if (scale < MOTION_EXPORT_LIMITS.minScale || scale > MOTION_EXPORT_LIMITS.maxScale) {
    throw new RangeError(
      `scale must be between ${MOTION_EXPORT_LIMITS.minScale} and ${MOTION_EXPORT_LIMITS.maxScale}`
    )
  }

  const durationMs = finitePositive('durationMs', options.durationMs)
  if (durationMs > MOTION_EXPORT_LIMITS.maxSourceDurationMs) {
    throw new RangeError(
      `durationMs exceeds the ${MOTION_EXPORT_LIMITS.maxSourceDurationMs}ms source limit`
    )
  }
  const sourceDurationUs = Math.max(1, Math.round(durationMs * 1_000))
  const totalDurationUs = sourceDurationUs * loops
  if (totalDurationUs > MOTION_EXPORT_LIMITS.maxTotalDurationMs * 1_000) {
    throw new RangeError(
      `total duration exceeds the ${MOTION_EXPORT_LIMITS.maxTotalDurationMs}ms limit`
    )
  }

  const width = finitePositive('width', options.width)
  const height = finitePositive('height', options.height)
  const pixelWidth = Math.ceil(width * scale)
  const pixelHeight = Math.ceil(height * scale)
  if (
    pixelWidth > MOTION_EXPORT_LIMITS.maxPixelDimension ||
    pixelHeight > MOTION_EXPORT_LIMITS.maxPixelDimension
  ) {
    throw new RangeError(
      `pixel dimensions exceed the ${MOTION_EXPORT_LIMITS.maxPixelDimension}px limit`
    )
  }
  const pixelArea = pixelWidth * pixelHeight
  if (pixelArea > MOTION_EXPORT_LIMITS.maxPixelArea) {
    throw new RangeError(`pixel area exceeds the ${MOTION_EXPORT_LIMITS.maxPixelArea} limit`)
  }

  const frameCount = Math.max(1, Math.ceil((totalDurationUs * fps) / 1_000_000))
  if (frameCount > MOTION_EXPORT_LIMITS.maxFrames) {
    throw new RangeError(`frame count exceeds the ${MOTION_EXPORT_LIMITS.maxFrames} frame limit`)
  }
  if (pixelArea * frameCount > MOTION_EXPORT_LIMITS.maxTotalPixels) {
    throw new RangeError(
      `total rendered pixels exceed the ${MOTION_EXPORT_LIMITS.maxTotalPixels} limit`
    )
  }

  const digits = Math.max(4, String(frameCount - 1).length)
  const frames: MotionPlannedFrame[] = []
  for (let index = 0; index < frameCount; index++) {
    const timestampUs = Math.floor((index * 1_000_000) / fps)
    const nextTimestampUs = Math.min(totalDurationUs, Math.floor(((index + 1) * 1_000_000) / fps))
    frames.push({
      index,
      fileName: `frame-${String(index).padStart(digits, '0')}.png`,
      numerator: index,
      denominator: fps,
      timestampUs,
      durationUs: Math.max(1, nextTimestampUs - timestampUs),
      loopIndex: Math.min(loops - 1, Math.floor(timestampUs / sourceDurationUs)),
      localTimeUs: timestampUs % sourceDurationUs
    })
  }

  return {
    version: 1,
    fps,
    timebase: { numerator: 1, denominator: fps },
    sourceDurationUs,
    totalDurationUs,
    loops,
    scale,
    width,
    height,
    pixelWidth,
    pixelHeight,
    frameCount,
    frames
  }
}
