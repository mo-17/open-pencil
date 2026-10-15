import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { configureControlPaint } from '#core/canvas/control-content'
import { moduleLabelTextNode, moduleMultilineLabelNode } from '#core/canvas/modules/label'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewClip,
  withModulePreviewRectClip
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  BADGE_MODULE_TYPE,
  BADGE_PLUGIN_ID,
  badgeDisplayValue,
  badgeIsVisible,
  badgeMetrics,
  resolveBadgeModule,
  type BadgeModuleConfigV1
} from '#core/plugins/badge'

export function badgePreviewGeometry(
  node: Pick<SceneNode, 'width' | 'height'>,
  config: BadgeModuleConfigV1
) {
  const size = badgeMetrics(config)
  const width = Math.min(Math.max(0, node.width), size.width)
  const height = Math.min(Math.max(0, node.height), size.height)
  const inset = size.contentInset
  return {
    badge: {
      x: config.placement.endsWith('left') ? 0 : node.width - width,
      y: config.placement.startsWith('top') ? 0 : node.height - height,
      width,
      height
    },
    host: {
      x: 16,
      y: 16,
      width: Math.max(0, node.width - 32),
      height: Math.max(0, node.height - 32)
    },
    content: {
      x: inset,
      y: inset,
      width: Math.max(0, node.width - inset * 2),
      height: Math.max(0, node.height - inset * 2)
    },
    fontSize: size.fontSize
  }
}

function drawBadgeText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  label: SceneNode,
  color: string,
  box: Rect
): void {
  if (box.width <= 0 || box.height <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') return
  const rgba = parseColor(color)
  withTextParagraph(
    renderer,
    label,
    renderer.color4f(rgba.r, rgba.g, rgba.b, rgba.a),
    { halfLeading: true },
    (paragraph) => {
      withModulePreviewRectClip(renderer, canvas, box, () =>
        paragraph.draw(canvas, box.x, box.y + Math.max(0, (box.height - paragraph.getHeight()) / 2))
      )
    }
  )
}

function roundedBox(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  radius: number,
  color: string
): void {
  if (box.width <= 0 || box.height <= 0) return
  configureModulePreviewPaint(renderer, color)
  canvas.drawRRect(
    renderer.ck.RRectXY(
      renderer.ck.LTRBRect(box.x, box.y, box.x + box.width, box.y + box.height),
      radius,
      radius
    ),
    renderer.fillPaint
  )
}

function paintBadge(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: BadgeModuleConfigV1,
  geometry: ReturnType<typeof badgePreviewGeometry>
): void {
  if (!badgeIsVisible(config)) return
  const { badge } = geometry
  roundedBox(renderer, canvas, badge, badge.height / 2, config.badgeColor)
  configureControlPaint(renderer, '#FFFFFF', 1, 2)
  canvas.drawRRect(
    renderer.ck.RRectXY(
      renderer.ck.LTRBRect(
        badge.x + 1,
        badge.y + 1,
        badge.x + badge.width - 1,
        badge.y + badge.height - 1
      ),
      Math.max(0, badge.height / 2 - 1),
      Math.max(0, badge.height / 2 - 1)
    ),
    renderer.auxStroke
  )
  if (config.mode === 'dot') return
  const textBox = {
    ...badge,
    x: badge.x + 6,
    width: Math.max(0, badge.width - 12)
  }
  const label = {
    ...moduleLabelTextNode(
      node,
      badgeDisplayValue(config),
      textBox.width,
      geometry.fontSize,
      node.textLanguage ?? 'en'
    ),
    fontWeight: 600,
    textAlignHorizontal: 'CENTER' as const,
    lineHeight: geometry.fontSize * 1.2
  }
  drawBadgeText(renderer, canvas, label, config.textColor, textBox)
}

export function renderBadgeModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveBadgeModule, ({ config }) => {
    const geometry = badgePreviewGeometry(node, config)
    withModulePreviewClip(renderer, canvas, node, () => {
      roundedBox(renderer, canvas, geometry.host, 8, config.hostBackground)
      const label = {
        ...moduleMultilineLabelNode(node, config.hostLabel, {
          width: geometry.content.width,
          fontSize: 14,
          fontWeight: 400,
          lineHeight: 20
        }),
        textAlignHorizontal: 'CENTER' as const
      }
      drawBadgeText(renderer, canvas, label, config.hostTextColor, geometry.content)
      paintBadge(renderer, canvas, node, config, geometry)
    })
  })
}

export const BADGE_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: BADGE_PLUGIN_ID,
  moduleType: BADGE_MODULE_TYPE,
  render: renderBadgeModulePreview
})
