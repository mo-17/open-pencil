import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneNode } from '@open-pencil/scene-graph'

interface DerivedTextDataOptions {
  node: SceneNode
  glyphs: NonNullable<NonNullable<NodeChange['derivedTextData']>['glyphs']>
  fontMetaData: NonNullable<NodeChange['derivedTextData']>['fontMetaData']
  baseline: number
  baselineX?: number
  baselineLineY?: number
  width: number
  lineHeight: number
  lineAscent: number
  baselines?: NonNullable<NodeChange['derivedTextData']>['baselines']
  logicalIndexToCharacterOffsetMap: number[]
}

export function buildDerivedTextData(
  options: DerivedTextDataOptions
): NodeChange['derivedTextData'] {
  return {
    layoutSize: { x: options.node.width, y: options.node.height },
    baselines: options.baselines ?? [
      {
        firstCharacter: 0,
        endCharacter: Array.from(options.node.text).length,
        position: { x: options.baselineX ?? 0, y: options.baseline },
        width: options.width,
        ...(options.baselineLineY === undefined ? {} : { lineY: options.baselineLineY }),
        lineHeight: options.lineHeight,
        lineAscent: options.lineAscent
      }
    ],
    ...(options.glyphs.length > 0 ? { glyphs: options.glyphs } : {}),
    fontMetaData: options.fontMetaData,
    logicalIndexToCharacterOffsetMap: options.logicalIndexToCharacterOffsetMap,
    derivedLines: [{ directionality: 'LTR' }],
    truncationStartIndex: -1,
    truncatedHeight: -1
  }
}
