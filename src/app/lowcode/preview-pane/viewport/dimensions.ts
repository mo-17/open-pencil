export const PREVIEW_MIN_DIMENSION = 240
export const PREVIEW_MAX_DIMENSION = 2560

export const PREVIEW_VIEWPORT_DIMENSIONS = {
  phone: [390, 844],
  landscape: [844, 390],
  tablet: [768, 1024],
  desktop: [1440, 1000]
} as const

export function boundPreviewDimension(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(PREVIEW_MIN_DIMENSION, Math.min(PREVIEW_MAX_DIMENSION, Math.round(value)))
}
