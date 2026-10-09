import { getEffectPickCatalogEntry } from './catalog'
import { requireEffectPickConfig } from './config'
import type { EffectPickConfigV1 } from './types'

function escapeMarkup(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Expand only reviewed text/character/SVG-ID slots; no raw HTML/CSS/JS is accepted. */
export function buildEffectPickMarkup(config: EffectPickConfigV1, instanceId = 'preview'): string {
  const settings = requireEffectPickConfig(config)
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(instanceId))
    throw new TypeError('Invalid EffectPick instance ID')
  const entry = getEffectPickCatalogEntry(settings.effectId)
  if (!entry) throw new TypeError(`Unknown EffectPick effect ${settings.effectId}`)
  const characters = Array.from(settings.text)
  const spans = characters
    .map(
      (character, index) =>
        `<span style="--wave-delay:${index * -110}ms">${escapeMarkup(character === ' ' ? '\u00a0' : character)}</span>`
    )
    .join('')
  const slots = {
    __EP_TEXT__: escapeMarkup(settings.text),
    __EP_CHARACTERS__: spans,
    __EP_INSTANCE__: instanceId,
    __EP_WATER_FONT_SIZE__: String(Math.min(142, 560 / Math.max(1, characters.length)))
  }
  // A single replacement pass prevents authored text from becoming another template instruction.
  return entry.artifact.markup.replace(
    /__EP_(?:TEXT|CHARACTERS|INSTANCE|WATER_FONT_SIZE)__/g,
    (token) => slots[token as keyof typeof slots]
  )
}
