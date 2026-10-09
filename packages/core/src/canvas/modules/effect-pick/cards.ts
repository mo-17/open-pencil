import type { Canvas } from 'canvaskit-wasm'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas/renderer'
import type { EffectPickConfigV1 } from '#core/plugins/effect-pick'

import {
  drawFamilyBox,
  drawFamilyGradient,
  drawFamilyLine,
  drawFamilyPath,
  familyPoint
} from './drawing'

export function drawFamilyCard(
  renderer: SkiaRenderer,
  canvas: Canvas,
  body: Rect,
  config: EffectPickConfigV1
): void {
  const box = {
    x: body.x + body.width * 0.06,
    y: body.y + body.height * 0.06,
    width: body.width * 0.88,
    height: body.height * 0.88
  }
  if (config.effectId === 'exploded-layer-card') {
    for (let layer = 2; layer >= 0; layer--)
      drawFamilyBox(
        renderer,
        canvas,
        {
          x: box.x + body.width * layer * 0.025,
          y: box.y - body.height * layer * 0.025,
          width: box.width - body.width * 0.05,
          height: box.height - body.height * 0.08
        },
        layer === 1 ? config.secondaryColor : config.color,
        layer === 0 ? 0.8 : 0.4,
        1.5
      )
  } else if (config.effectId === 'tilt-card') {
    drawFamilyPath(
      renderer,
      canvas,
      config.color,
      (path) => {
        const points = [
          [0.05, 0.16],
          [0.95, 0.04],
          [0.87, 0.9],
          [0.12, 0.98]
        ]
        for (const [index, point] of points.entries()) {
          const position = familyPoint(box, point[0], point[1])
          if (index === 0) path.moveTo(position.x, position.y)
          else path.lineTo(position.x, position.y)
        }
        path.close()
      },
      1,
      1.5
    )
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0.2, 0.36),
      familyPoint(box, 0.75, 0.29),
      config.secondaryColor
    )
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0.22, 0.57),
      familyPoint(box, 0.58, 0.53),
      config.color,
      0.6,
      3
    )
  } else {
    drawFamilyGradient(renderer, canvas, box, config, 0.12)
    drawFamilyBox(renderer, canvas, box, config.color, 0.9, 1.5)
    if (config.effectId === 'gatefold-reveal-card') {
      drawFamilyLine(
        renderer,
        canvas,
        familyPoint(box, 0.5, 0.05),
        familyPoint(box, 0.5, 0.95),
        config.color
      )
      for (const x of [0.44, 0.56])
        drawFamilyLine(
          renderer,
          canvas,
          familyPoint(box, x, 0.38),
          familyPoint(box, x, 0.62),
          config.secondaryColor,
          1,
          3
        )
    } else {
      drawFamilyPath(
        renderer,
        canvas,
        config.secondaryColor,
        (path) => {
          const top = familyPoint(box, 0.62, 0)
          path.moveTo(top.x, top.y)
          const right = familyPoint(box, 0.88, 0)
          path.lineTo(right.x, right.y)
          const bottom = familyPoint(box, 0.38, 1)
          path.lineTo(bottom.x, bottom.y)
          const left = familyPoint(box, 0.12, 1)
          path.lineTo(left.x, left.y)
          path.close()
        },
        0.3
      )
    }
  }
}
