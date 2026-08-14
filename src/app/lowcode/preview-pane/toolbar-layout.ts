export type PreviewToolbarBand = 'tiny' | 'narrow' | 'medium' | 'wide'

export function resolvePreviewToolbarBand(width: number): PreviewToolbarBand {
  if (width >= 880) return 'wide'
  if (width >= 560) return 'medium'
  if (width >= 320) return 'narrow'
  return 'tiny'
}
