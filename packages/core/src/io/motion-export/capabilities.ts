import { BUILTIN_MOTION_ANIMATION_ENCODERS } from './gif'
import type { MotionAnimationEncoder, MotionExportCapability, MotionExportFormat } from './types'

const UNAVAILABLE_REASONS: Record<Exclude<MotionExportFormat, 'png-sequence'>, string> = {
  gif: 'the built-in GIF encoder is unavailable in this runtime',
  webm: 'no WebM encoder is registered in this runtime',
  mp4: 'no allowlisted desktop ffmpeg/MP4 encoder capability is registered in this runtime'
}

export function resolveMotionAnimationEncoders(
  encoders: readonly MotionAnimationEncoder[] = []
): readonly MotionAnimationEncoder[] {
  const resolved = new Map(
    BUILTIN_MOTION_ANIMATION_ENCODERS.map((encoder) => [encoder.format, encoder])
  )
  for (const encoder of encoders) resolved.set(encoder.format, encoder)
  return [...resolved.values()]
}

export function getMotionExportCapabilities(
  encoders: readonly MotionAnimationEncoder[] = []
): readonly MotionExportCapability[] {
  const injectedFormats = new Set(encoders.map((encoder) => encoder.format))
  const byFormat = new Map(
    resolveMotionAnimationEncoders(encoders).map((encoder) => [encoder.format, encoder])
  )
  const optional = (format: 'gif' | 'webm' | 'mp4'): MotionExportCapability => {
    const encoder = byFormat.get(format)
    const mode = injectedFormats.has(format) ? 'injected' : 'builtin'
    return encoder
      ? {
          format,
          available: true,
          mode,
          reason: encoder.capability,
          encoder: encoder.capability,
          alpha: encoder.alpha ?? 'unknown',
          determinism: encoder.determinism ?? 'timeline-exact'
        }
      : { format, available: false, mode: 'unavailable', reason: UNAVAILABLE_REASONS[format] }
  }
  return [
    { format: 'png-sequence', available: true, mode: 'builtin' },
    optional('gif'),
    optional('webm'),
    optional('mp4')
  ]
}

export function motionExportUnavailableReason(
  format: Exclude<MotionExportFormat, 'png-sequence'>
): string {
  return UNAVAILABLE_REASONS[format]
}
