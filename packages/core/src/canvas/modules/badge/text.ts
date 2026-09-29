import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import {
  badgeDisplayValue,
  badgeIsVisible,
  badgeMetrics,
  resolveBadgeModule
} from '#core/plugins/badge'

/** Decorative dots have no synthetic status text; numeric glyphs use the configured badge size. */
export function badgeTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveBadgeModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  const value = badgeIsVisible(config) ? badgeDisplayValue(config) : ''
  return {
    ...moduleLabelTextNode(
      node,
      config.hostLabel + (value ? '\n' + value : ''),
      node.width,
      14,
      node.textLanguage ?? 'en'
    ),
    styleRuns: value
      ? [
          {
            start: config.hostLabel.length + 1,
            length: value.length,
            style: { fontWeight: 600, fontSize: badgeMetrics(config).fontSize }
          }
        ]
      : []
  }
}
