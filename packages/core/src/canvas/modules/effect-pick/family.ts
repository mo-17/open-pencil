import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas/renderer'
import type { EffectPickBehavior, EffectPickConfigV1 } from '#core/plugins/effect-pick'

import { drawFamilyBackground } from './backgrounds'
import { drawFamilyCard } from './cards'
import {
  drawFamilyBox,
  drawFamilyGradient,
  drawFamilyLabel,
  drawFamilyLine,
  drawFamilyPath,
  familyBody,
  familyPoint,
  familyRegions
} from './drawing'
import { drawFamilyLoader } from './loaders'

function drawButton(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: EffectPickConfigV1,
  body: Rect
) {
  const height = Math.min(76, body.height)
  const box = { ...body, y: (node.height - height) / 2, height }
  if (config.effectId === 'gradient-button') drawFamilyGradient(renderer, canvas, box, config, 0.18)
  drawFamilyBox(renderer, canvas, box, config.color, 1, 1.5)
  const arrow = config.effectId === 'arrow-expand'
  if (arrow) {
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0.82, 0.5),
      familyPoint(box, 0.93, 0.5),
      config.color
    )
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0.89, 0.35),
      familyPoint(box, 0.93, 0.5),
      config.color
    )
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0.89, 0.65),
      familyPoint(box, 0.93, 0.5),
      config.color
    )
  } else if (config.effectId === 'border-trace') {
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0.04, 0.03),
      familyPoint(box, 0.28, 0.03),
      config.secondaryColor,
      1,
      3
    )
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0.97, 0.04),
      familyPoint(box, 0.97, 0.45),
      config.secondaryColor,
      1,
      3
    )
  } else if (config.effectId === 'underline-slide')
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0.25, 0.9),
      familyPoint(box, 0.75, 0.9),
      config.color,
      1,
      2
    )
  drawFamilyLabel(renderer, canvas, node, config, {
    x: box.x + box.width * 0.06,
    y: box.y + 2,
    width: box.width * (arrow ? 0.72 : 0.88),
    height: Math.max(0, box.height - 4)
  })
}

function drawTextGlyph(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  config: EffectPickConfigV1
) {
  if (config.effectId === 'text-zoom-trail') {
    for (let layer = 2; layer >= 0; layer--)
      drawFamilyBox(
        renderer,
        canvas,
        {
          x: box.x + box.width * (0.28 - layer * 0.05),
          y: box.y + box.height * (0.18 + layer * 0.1),
          width: box.width * 0.44,
          height: box.height * 0.62
        },
        layer ? config.secondaryColor : config.color,
        layer ? 0.3 : 1,
        1.5
      )
    return
  }
  drawFamilyPath(
    renderer,
    canvas,
    config.color,
    (path) => {
      const left = familyPoint(box, 0.34, 0.85)
      const top = familyPoint(box, 0.5, 0.14)
      const right = familyPoint(box, 0.66, 0.85)
      path.moveTo(left.x, left.y)
      path.lineTo(top.x, top.y)
      path.lineTo(right.x, right.y)
    },
    1,
    2
  )
  drawFamilyLine(
    renderer,
    canvas,
    familyPoint(box, 0.42, 0.55),
    familyPoint(box, 0.58, 0.55),
    config.color,
    1,
    2
  )
  if (config.effectId === 'text-mask-reveal')
    drawFamilyBox(
      renderer,
      canvas,
      { ...box, x: box.x + box.width * 0.52, width: box.width * 0.17 },
      config.secondaryColor,
      0.25
    )
  else if (config.effectId === 'gradient-stroke-text')
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0.28, 0.95),
      familyPoint(box, 0.72, 0.95),
      config.secondaryColor,
      1,
      3
    )
  else
    drawFamilyBox(
      renderer,
      canvas,
      {
        x: box.x + box.width * 0.48,
        y: box.y + box.height * 0.45,
        width: box.width * 0.12,
        height: box.height * 0.3
      },
      config.secondaryColor,
      0.3
    )
}

/** Batch 0.7 gets family silhouettes; original 0.6 artifacts retain their resting projection. */
export function drawEffectPickFamily(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: EffectPickConfigV1,
  behavior: EffectPickBehavior
): void {
  const body = familyBody(node)
  if (behavior === 'button') {
    drawButton(renderer, canvas, node, config, body)
    return
  }
  const { glyph, label } = familyRegions(body)
  if (behavior === 'gradient') drawFamilyBackground(renderer, canvas, body, config)
  else if (behavior === 'card') drawFamilyCard(renderer, canvas, glyph, config)
  else if (behavior === 'loader') drawFamilyLoader(renderer, canvas, glyph, config)
  else drawTextGlyph(renderer, canvas, glyph, config)
  drawFamilyLabel(renderer, canvas, node, config, behavior === 'gradient' ? body : label)
}
