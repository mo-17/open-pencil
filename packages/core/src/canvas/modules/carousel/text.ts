import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import {
  resolveCarouselModule,
  type CarouselModuleConfigV1,
  type CarouselModuleConfigV2
} from '#core/plugins/carousel'

export type CarouselTextRole = 'title' | 'description' | 'caption'

export function carouselPreviewLabel(config: CarouselModuleConfigV1): string {
  return `${config.initialIndex + 1} / ${config.slides.length}`
}

function paginationText(config: CarouselModuleConfigV2): string {
  if (!config.showDots) return ''
  if (config.paginationStyle === 'numbers')
    return config.slides.map((_, index) => String(index + 1)).join(' ')
  return config.paginationStyle === 'fraction' ? carouselPreviewLabel(config) : ''
}

export function carouselLabelNode(
  host: SceneNode,
  text: string,
  role: CarouselTextRole,
  bounds: Rect,
  alignment: SceneNode['textAlignHorizontal'] = 'LEFT'
): SceneNode {
  const sizes = { title: 24, description: 14, caption: 12 }
  const fontSize = sizes[role]
  return {
    ...moduleLabelTextNode(host, text, bounds.width, fontSize, host.textLanguage ?? 'en'),
    height: bounds.height,
    fontWeight: role === 'title' ? 600 : 400,
    lineHeight: fontSize * (role === 'title' ? 1.25 : 1.5),
    textAlignHorizontal: role === 'caption' ? 'CENTER' : alignment,
    textTruncation: role === 'caption' ? 'ENDING' : 'DISABLED',
    maxLines: role === 'caption' ? 1 : null
  }
}

/** Describe just the static selected slide; remote image URLs are never font content. */
export function carouselTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME' || node.width <= 0 || node.height <= 0) return null
  const resolved = resolveCarouselModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const slide = config.slides[config.initialIndex]
  const parts = [
    slide.title,
    slide.description,
    slide.imageUrl && config.layout === 'split' ? slide.alt : '',
    paginationText(config)
  ]
  return {
    ...moduleLabelTextNode(
      node,
      parts.filter(Boolean).join('\n'),
      node.width,
      14,
      node.textLanguage ?? 'en'
    ),
    styleRuns: [{ start: 0, length: slide.title.length, style: { fontWeight: 600 } }]
  }
}
