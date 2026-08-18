import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { DerivedTextGlyph } from '@open-pencil/scene-graph'

/** Preserve the per-glyph rotation used by Figma text-on-path layers. */
export function convertFigmaDerivedTextGlyphs(
  derivedTextData: NodeChange['derivedTextData'],
  blobs: Uint8Array[]
): DerivedTextGlyph[] {
  return (derivedTextData?.glyphs ?? [])
    .map((glyph) => {
      const commandsBlob = resolveCommandsBlob(glyph.commandsBlob, blobs)
      if (!commandsBlob) return null
      return {
        commandsBlob,
        x: glyph.position.x,
        y: glyph.position.y,
        fontSize: glyph.fontSize,
        rotation: glyph.rotation
      }
    })
    .filter((glyph): glyph is NonNullable<typeof glyph> => !!glyph)
}

function resolveCommandsBlob(value: unknown, blobs: Uint8Array[]): Uint8Array | undefined {
  if (typeof value === 'number') return blobs[value]
  if (value === null || typeof value !== 'object' || !('__openPencilFigmaBlob' in value)) {
    return undefined
  }
  const blob = (value as { __openPencilFigmaBlob?: unknown }).__openPencilFigmaBlob
  return blob instanceof Uint8Array ? blob : undefined
}
