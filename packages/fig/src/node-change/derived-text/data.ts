import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneNode } from '@open-pencil/scene-graph'

type DerivedTextData = NonNullable<NodeChange['derivedTextData']>

interface DerivedTextDataOptions {
  node: SceneNode
  glyphs: DerivedTextData['glyphs']
  decorations?: DerivedTextData['decorations']
  fontMetaData: DerivedTextData['fontMetaData']
  baselines?: DerivedTextData['baselines']
  baseline?: number
  baselineX?: number
  baselineLineY?: number
  width?: number
  lineHeight?: number
  lineAscent?: number
  logicalIndexToCharacterOffsetMap: number[]
}

export function buildDerivedTextData(
  options: DerivedTextDataOptions
): NodeChange['derivedTextData'] {
  return {
    layoutSize: { x: options.node.width, y: options.node.height },
    baselines:
      options.baselines ??
      (options.baseline === undefined
        ? []
        : [
            {
              firstCharacter: 0,
              endCharacter: Array.from(options.node.text).length,
              position: { x: options.baselineX ?? 0, y: options.baseline },
              width: options.width ?? options.node.width,
              ...(options.baselineLineY === undefined ? {} : { lineY: options.baselineLineY }),
              lineHeight: options.lineHeight ?? options.node.fontSize,
              lineAscent: options.lineAscent ?? options.node.fontSize
            }
          ]),
    glyphs: options.glyphs,
    ...(options.decorations ? { decorations: options.decorations } : {}),
    fontMetaData: options.fontMetaData,
    logicalIndexToCharacterOffsetMap: options.logicalIndexToCharacterOffsetMap,
    derivedLines: [{ directionality: 'LTR' }],
    truncationStartIndex: -1,
    truncatedHeight: -1
  }
}
