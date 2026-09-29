import { avatarFallbackText, type AvatarModuleConfigV1 } from '#core/plugins/avatar'

export function avatarPreviewGeometry(width: number, height: number, config: AvatarModuleConfigV1) {
  const size = Math.max(0, Math.min(width, height, config.size))
  const scale = size / config.size
  const text = avatarFallbackText(config)
  let radius = 0
  if (config.shape === 'circle') radius = size / 2
  if (config.shape === 'rounded') radius = Math.min(size / 2, config.borderRadius * scale)
  return {
    size,
    x: Math.max(0, (width - size) / 2),
    y: Math.max(0, (height - size) / 2),
    radius,
    border: config.borderWidth * scale,
    fontSize:
      Math.min(config.fontSize, (config.size * 0.7) / Math.max(1, Array.from(text).length)) * scale,
    text
  }
}
