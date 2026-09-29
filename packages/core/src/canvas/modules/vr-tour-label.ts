import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import type { VRTourLocale } from '#core/plugins/vr-tour'

import { drawModuleLabel, moduleLabelTextNode, type ModuleLabelOptions } from './label'

export function vrTourLabelTextNode(
  host: SceneNode,
  text: string,
  width: number,
  fontSize: number,
  locale: VRTourLocale = 'en'
): SceneNode {
  return moduleLabelTextNode(host, text, width, fontSize, locale)
}

export function drawVRTourLabel(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  options: ModuleLabelOptions & { locale?: VRTourLocale }
): void {
  drawModuleLabel(renderer, canvas, host, options)
}
