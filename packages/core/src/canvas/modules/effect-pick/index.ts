import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { configureControlPaint } from '#core/canvas/control-content'
import {
  renderResolvedModulePreview,
  withModulePreviewClip,
  withModulePreviewRectClip
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  EFFECT_PICK_MODULE_TYPE,
  EFFECT_PICK_PLUGIN_ID,
  getEffectPickCatalogEntry,
  resolveEffectPickModule,
  type EffectPickConfigV1
} from '#core/plugins/effect-pick'

import { withEffectPickPreviewParagraph } from './drawing'
import { drawEffectPickFamily } from './family'
import { EFFECT_PICK_PREVIEW_LINE_HEIGHT, effectPickPreviewLabel } from './text'

const BUTTON_PADDING_Y = 12
const BUTTON_BORDER_WIDTH = 1
const BUTTON_LOADING_WIDTH = 160

function previewInset(node: SceneNode): number {
  return Math.min(16, Math.max(8, Math.min(node.width, node.height) * 0.04))
}

function drawButtonOutline(renderer: SkiaRenderer, canvas: Canvas, box: Rect, color: string): void {
  configureControlPaint(renderer, color, 1, BUTTON_BORDER_WIDTH)
  const halfBorder = BUTTON_BORDER_WIDTH / 2
  canvas.drawRect(
    renderer.ck.LTRBRect(
      box.x + halfBorder,
      box.y + halfBorder,
      box.x + box.width - halfBorder,
      box.y + box.height - halfBorder
    ),
    renderer.auxStroke
  )
}

function drawDiagonalButton(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: EffectPickConfigV1
): void {
  const inset = previewInset(node)
  const availableWidth = Math.max(0, node.width - inset * 2)
  const availableHeight = Math.max(0, node.height - inset * 2)
  if (availableWidth <= BUTTON_BORDER_WIDTH * 2 || availableHeight <= BUTTON_BORDER_WIDTH * 2)
    return
  const paddingX = Math.min(41.6, Math.max(9.6, node.width * 0.08))
  const paddingHeight = (BUTTON_PADDING_Y + BUTTON_BORDER_WIDTH) * 2
  const textWidth = Math.max(0, availableWidth - (paddingX + BUTTON_BORDER_WIDTH) * 2)
  const maxLines = Math.max(
    1,
    Math.floor((availableHeight - paddingHeight) / EFFECT_PICK_PREVIEW_LINE_HEIGHT)
  )
  const label = effectPickPreviewLabel(node, config.text, textWidth, maxLines)
  const draw = (width: number, height: number) => {
    const box = {
      x: (node.width - width) / 2,
      y: (node.height - height) / 2,
      width,
      height
    }
    drawButtonOutline(renderer, canvas, box, config.color)
    return box
  }
  if (!config.text) {
    draw(
      Math.min(availableWidth, (paddingX + BUTTON_BORDER_WIDTH) * 2),
      Math.min(availableHeight, paddingHeight)
    )
    return
  }
  const drawPending = () =>
    draw(
      Math.min(availableWidth, BUTTON_LOADING_WIDTH),
      Math.min(availableHeight, EFFECT_PICK_PREVIEW_LINE_HEIGHT + paddingHeight)
    )
  if (textWidth <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) {
    drawPending()
    return
  }
  const readiness = renderer.nodeFontReadiness(label)
  if (readiness !== 'ready' && readiness !== 'substituted') {
    drawPending()
    return
  }
  const color = parseColor(config.color)
  withTextParagraph(
    renderer,
    label,
    renderer.color4f(color.r, color.g, color.b, color.a),
    { halfLeading: true },
    (paragraph) => {
      const width = Math.min(
        availableWidth,
        Math.ceil(paragraph.getMaxIntrinsicWidth()) + (paddingX + BUTTON_BORDER_WIDTH) * 2
      )
      const height = Math.min(availableHeight, paragraph.getHeight() + paddingHeight)
      const box = draw(width, height)
      withModulePreviewRectClip(
        renderer,
        canvas,
        {
          x: box.x + BUTTON_BORDER_WIDTH,
          y: box.y + BUTTON_BORDER_WIDTH,
          width: box.width - BUTTON_BORDER_WIDTH * 2,
          height: box.height - BUTTON_BORDER_WIDTH * 2
        },
        () =>
          paragraph.draw(
            canvas,
            (node.width - textWidth) / 2,
            (node.height - paragraph.getHeight()) / 2
          )
      )
    }
  )
}

function drawEffectCopy(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: EffectPickConfigV1
): void {
  const inset = previewInset(node)
  const width = Math.max(0, node.width - inset * 2)
  const height = Math.max(0, node.height - inset * 2)
  if (width <= 0 || height <= 0) return
  configureControlPaint(renderer, config.color, 1)
  const ruleWidth = Math.min(32, width)
  canvas.drawRect(
    renderer.ck.LTRBRect(
      (node.width - ruleWidth) / 2,
      inset,
      (node.width + ruleWidth) / 2,
      inset + 2
    ),
    renderer.fillPaint
  )
  if (!renderer.fontProvider || !renderer.fontsLoaded) return
  withEffectPickPreviewParagraph(
    renderer,
    node,
    config,
    width,
    Math.min(3, Math.max(1, Math.floor(height / EFFECT_PICK_PREVIEW_LINE_HEIGHT))),
    (paragraph) => {
      withModulePreviewRectClip(
        renderer,
        canvas,
        { x: inset, y: inset + 6, width, height: Math.max(0, height - 6) },
        () =>
          paragraph.draw(
            canvas,
            inset,
            Math.max(inset + 6, (node.height - paragraph.getHeight()) / 2)
          )
      )
    }
  )
}

/** Resting content is drawn directly; the document remains one native module FRAME. */
export function renderEffectPickModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveEffectPickModule, ({ config }) => {
    withModulePreviewClip(renderer, canvas, node, () => {
      const entry = getEffectPickCatalogEntry(config.effectId)
      if (entry?.collectionVersion === '0.7.0')
        drawEffectPickFamily(renderer, canvas, node, config, entry.artifact.behavior)
      else if (config.effectId === 'diagonal-fill')
        drawDiagonalButton(renderer, canvas, node, config)
      else drawEffectCopy(renderer, canvas, node, config)
    })
  })
}

export const EFFECT_PICK_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: EFFECT_PICK_PLUGIN_ID,
  moduleType: EFFECT_PICK_MODULE_TYPE,
  render: renderEffectPickModulePreview
})
