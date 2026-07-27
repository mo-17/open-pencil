import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { normalizeFontFamily, weightToStyle } from '@open-pencil/scene-graph'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { FigNodeChangeExportRuntime } from '../export-runtime'
import { weightToFigmaStyle } from '../font/style'

type FontMetaData = NonNullable<NodeChange['derivedTextData']>['fontMetaData']

function naturalLineHeightRatio(
  runtime: FigNodeChangeExportRuntime,
  family: string,
  style: string,
  fontSize: number
): number {
  if (fontSize <= 0) return 1.2
  const metrics = runtime.getFontVerticalMetrics?.(family, style, fontSize)
  return metrics ? metrics.naturalLineHeight / fontSize : 1.2
}

export function buildDerivedTextFontMetaData(
  node: SceneNode,
  digestMap: Map<string, Uint8Array>,
  runtime: FigNodeChangeExportRuntime
): FontMetaData {
  const fontMeta: FontMetaData = []
  const seen = new Set<string>()

  const addFont = (family: string, weight: number, italic: boolean, fontSize: number) => {
    const style = weightToStyle(weight, italic)
    const normalized = normalizeFontFamily(family)
    const key = `${normalized}|${style}`
    if (seen.has(key)) return
    seen.add(key)
    fontMeta.push({
      key: { family: normalized, style: weightToFigmaStyle(weight, italic), postscript: '' },
      fontLineHeight: naturalLineHeightRatio(runtime, normalized, style, fontSize),
      fontDigest: digestMap.get(key),
      fontStyle: italic ? 'ITALIC' : 'NORMAL',
      fontWeight: weight
    })
  }

  addFont(node.fontFamily, node.fontWeight, node.italic, node.fontSize)
  for (const run of node.styleRuns) {
    addFont(
      run.style.fontFamily ?? node.fontFamily,
      run.style.fontWeight ?? node.fontWeight,
      run.style.italic ?? node.italic,
      run.style.fontSize ?? node.fontSize
    )
  }
  return fontMeta
}
