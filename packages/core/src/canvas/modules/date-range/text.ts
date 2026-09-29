import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleTitleDescriptionTextNode } from '#core/canvas/modules/label'
import {
  DATE_RANGE_MESSAGES,
  dateRangeLocale,
  resolveDateRangeModule
} from '#core/plugins/date-range'

export function dateRangeNodeLanguage(node: SceneNode): string {
  const language = node.interactiveProps?.lang
  return typeof language === 'string' && language.trim() ? language : node.textLanguage || 'en'
}
export function dateRangeTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const result = resolveDateRangeModule(node.interactiveProps?.module)
  if (!result?.ok) return null
  const { config } = result
  const copy = DATE_RANGE_MESSAGES[dateRangeLocale(dateRangeNodeLanguage(node))]
  return moduleTitleDescriptionTextNode(
    { ...node, textLanguage: dateRangeNodeLanguage(node) },
    {
      title: config.label,
      description: [
        config.startLabel,
        config.endLabel,
        config.initialStart,
        config.initialEnd,
        'YYYY-MM-DD',
        ...Object.values(copy)
      ].join('\n'),
      fontSize: config.fontSize
    }
  )
}
