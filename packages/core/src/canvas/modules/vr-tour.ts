import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  VR_TOUR_MODULE_TYPE,
  VR_TOUR_PLUGIN_ID,
  resolveVRTourModule,
  type VRTourModuleConfigV1,
  type VRTourSceneV1
} from '#core/plugins/vr-tour'

import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewFont,
  withModulePreviewSurface
} from './preview'
import type { ModuleCanvasAdapter } from './types'
import { drawVRTourLabel } from './vr-tour-label'

export function vrTourPreviewLabel(config: VRTourModuleConfigV1): string {
  const scene = config.scenes.find((entry) => entry.id === config.initialSceneId)
  const count =
    config.locale === 'zh-CN' ? `${config.scenes.length} 个场景` : `${config.scenes.length} rooms`
  return `${scene?.title ?? config.label} · 360° · ${count}`
}

function drawRoom(renderer: SkiaRenderer, canvas: Canvas, width: number, height: number): void {
  const left = width * 0.26
  const right = width * 0.74
  const top = height * 0.24
  const bottom = height * 0.65
  configureModulePreviewPaint(renderer, '#1E293B')
  canvas.drawRect(renderer.ck.LTRBRect(left, top, right, bottom), renderer.fillPaint)
  configureModulePreviewPaint(renderer, '#334155')
  const corners = [
    [0, 0, left, top],
    [width, 0, right, top],
    [0, height, left, bottom],
    [width, height, right, bottom]
  ]
  for (const [x1, y1, x2, y2] of corners) canvas.drawLine(x1, y1, x2, y2, renderer.fillPaint)
  canvas.drawLine(left, top, right, top, renderer.fillPaint)
  canvas.drawLine(left, bottom, right, bottom, renderer.fillPaint)
  canvas.drawLine(left, top, left, bottom, renderer.fillPaint)
  canvas.drawLine(right, top, right, bottom, renderer.fillPaint)
  for (let index = 1; index < 4; index++) {
    const y = bottom + ((height - bottom) * index) / 4
    canvas.drawLine(0, y, width, y, renderer.fillPaint)
  }
  configureModulePreviewPaint(renderer, '#475569')
  canvas.drawRect(
    renderer.ck.LTRBRect(width * 0.36, height * 0.31, width * 0.49, height * 0.48),
    renderer.fillPaint
  )
  configureModulePreviewPaint(renderer, '#1E293B')
  canvas.drawRect(
    renderer.ck.LTRBRect(width * 0.37, height * 0.32, width * 0.48, height * 0.47),
    renderer.fillPaint
  )
}

function drawHotspots(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  scene: VRTourSceneV1,
  config: VRTourModuleConfigV1,
  width: number,
  height: number
): void {
  for (const hotspot of scene.hotspots) {
    const yaw = ((hotspot.yaw - config.initialYaw + 540) % 360) - 180
    const pitch = hotspot.pitch - config.initialPitch
    if (Math.abs(yaw) > config.initialFov / 2 || Math.abs(pitch) > config.initialFov / 2) continue
    const x = width * (0.5 + (yaw / config.initialFov) * 0.65)
    const y = height * (0.5 - (pitch / config.initialFov) * 0.65)
    configureModulePreviewPaint(renderer, config.accentColor)
    canvas.drawCircle(x, y, 12, renderer.fillPaint)
    configureModulePreviewPaint(renderer, config.backgroundColor)
    canvas.drawCircle(x, y, 5, renderer.fillPaint)
    drawVRTourLabel(renderer, canvas, node, {
      text: hotspot.label,
      x: x + 18,
      baseline: y + 4,
      maxWidth: Math.max(0, width - x - 24),
      color: config.textColor,
      locale: config.locale
    })
  }
}

function drawLabels(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: VRTourModuleConfigV1,
  width: number,
  height: number
): void {
  const font = renderer.labelFont
  if (!font || width < 100 || height < 90) return
  const inset = Math.min(24, width * 0.04)
  const labelWidth = Math.max(0, width - inset * 2)
  drawVRTourLabel(renderer, canvas, node, {
    text: vrTourPreviewLabel(config),
    x: inset,
    baseline: inset + 12,
    maxWidth: labelWidth,
    color: config.textColor,
    locale: config.locale
  })
  drawVRTourLabel(renderer, canvas, node, {
    text:
      config.locale === 'zh-CN'
        ? '离线示意图 · 在预览中探索'
        : 'Offline diagram · Preview to explore',
    x: inset,
    baseline: height - inset,
    maxWidth: labelWidth,
    color: config.accentColor,
    locale: config.locale
  })
  if (config.showSceneList && height >= 180) {
    drawVRTourLabel(renderer, canvas, node, {
      text: config.scenes.map((scene) => scene.title).join(' / '),
      x: inset,
      baseline: height - inset - 24,
      maxWidth: labelWidth,
      color: config.textColor,
      locale: config.locale
    })
  }
  if (config.showControls && width >= 180 && height >= 140) {
    drawVRTourLabel(renderer, canvas, node, {
      text: '−   +',
      x: width - inset - 44,
      baseline: inset + 40,
      maxWidth: 44,
      color: config.textColor,
      locale: config.locale
    })
  }
}

/** Offline diagram only: no texture loads, timer, DOM, credential or network access. */
export function renderVRTourModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveVRTourModule, (frame) => {
    const { width, height, config } = frame
    withModulePreviewFont(renderer, Math.max(9, Math.min(14, height * 0.035)), () => {
      withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
        drawRoom(renderer, canvas, width, height)
        const scene = config.scenes.find((entry) => entry.id === config.initialSceneId)
        if (scene && width >= 160 && height >= 140)
          drawHotspots(renderer, canvas, node, scene, config, width, height)
        drawLabels(renderer, canvas, node, config, width, height)
      })
    })
  })
}

export const VR_TOUR_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: VR_TOUR_PLUGIN_ID,
  moduleType: VR_TOUR_MODULE_TYPE,
  render: renderVRTourModulePreview
})
