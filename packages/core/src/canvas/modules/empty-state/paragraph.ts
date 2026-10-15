import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleMultilineLabelNode } from '#core/canvas/modules/label'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { TextLayout } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  EMPTY_STATE_LAYOUT,
  emptyStateGeometry,
  type EmptyStateModuleConfigV1
} from '#core/plugins/empty-state'

export function emptyStateParagraph(
  renderer: SkiaRenderer,
  node: SceneNode,
  config: EmptyStateModuleConfigV1,
  heading: boolean
): TextLayout | undefined {
  const text = heading ? config.title : config.description
  const width = emptyStateGeometry(node.width, node.height, config, 0, 0).title.width
  if (!text || width <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return undefined
  const fontSize = config.fontSize * (heading ? EMPTY_STATE_LAYOUT.titleScale : 1)
  const label: SceneNode = {
    ...moduleMultilineLabelNode(node, text, {
      width,
      fontSize,
      fontWeight: heading ? 600 : 400,
      lineHeight: fontSize * EMPTY_STATE_LAYOUT.lineHeight
    }),
    textAlignHorizontal: config.alignment === 'center' ? 'CENTER' : 'LEFT'
  }
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return undefined
  const color = parseColor(heading ? config.textColor : config.descriptionColor)
  return renderer.buildParagraph(label, renderer.color4f(color.r, color.g, color.b, color.a), {
    halfLeading: true
  })
}
