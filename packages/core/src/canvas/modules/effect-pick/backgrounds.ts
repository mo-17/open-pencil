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

function drawCurtains(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  config: EffectPickConfigV1
) {
  for (let index = 0; index < 5; index++) {
    const x = box.x + (box.width * index) / 5
    const width = box.width / 3
    drawFamilyPath(
      renderer,
      canvas,
      index % 2 ? config.secondaryColor : config.color,
      (path) => {
        path.moveTo(x, box.y)
        path.cubicTo(
          x - width * 0.4,
          box.y + box.height * 0.4,
          x + width,
          box.y + box.height * 0.6,
          x,
          box.y + box.height
        )
        path.lineTo(x + width * 0.5, box.y + box.height)
        path.cubicTo(
          x + width * 1.5,
          box.y + box.height * 0.6,
          x,
          box.y + box.height * 0.4,
          x + width * 0.5,
          box.y
        )
        path.close()
      },
      0.18
    )
  }
}

function drawHexGrid(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  config: EffectPickConfigV1
) {
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 6; column++) {
      const cx = box.x + ((column + 0.5) * box.width) / 6
      const cy = box.y + ((row + 0.5) * box.height) / 4
      drawFamilyPath(
        renderer,
        canvas,
        (row + column) % 2 ? config.secondaryColor : config.color,
        (path) => {
          for (let corner = 0; corner < 6; corner++) {
            const angle = (corner * Math.PI) / 3
            const x = cx + (Math.cos(angle) * box.width) / 14
            const y = cy + (Math.sin(angle) * box.height) / 9
            if (corner === 0) path.moveTo(x, y)
            else path.lineTo(x, y)
          }
          path.close()
        },
        0.45,
        1
      )
    }
  }
}

function drawPerspectiveGrid(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  config: EffectPickConfigV1
) {
  const vanishing = familyPoint(box, 0.5, 0.08)
  for (let index = 0; index <= 8; index++)
    drawFamilyLine(renderer, canvas, vanishing, familyPoint(box, index / 8, 1), config.color, 0.6)
  for (const y of [0.25, 0.4, 0.6, 0.85])
    drawFamilyLine(
      renderer,
      canvas,
      familyPoint(box, 0, y),
      familyPoint(box, 1, y),
      config.secondaryColor,
      0.6
    )
}

/** Deterministic patterns show the background family without sampling an animation clock. */
export function drawFamilyBackground(
  renderer: SkiaRenderer,
  canvas: Canvas,
  box: Rect,
  config: EffectPickConfigV1
): void {
  drawFamilyGradient(renderer, canvas, box, config, 0.12)
  if (config.effectId === 'aurora-curtains') drawCurtains(renderer, canvas, box, config)
  else if (config.effectId === 'hex-grid-pulse') drawHexGrid(renderer, canvas, box, config)
  else if (config.effectId === 'perspective-grid-floor')
    drawPerspectiveGrid(renderer, canvas, box, config)
  else {
    for (let index = 0; index < 4; index++) {
      const size = Math.min(box.width, box.height) * 0.5
      drawFamilyBox(
        renderer,
        canvas,
        {
          x: box.x + (box.width - size) * (index % 2),
          y: box.y + (box.height - size) * Math.floor(index / 2),
          width: size,
          height: size
        },
        index % 2 ? config.secondaryColor : config.color,
        0.22
      )
    }
  }
}
