import type { Canvas } from 'canvaskit-wasm'

import {
  DEFAULT_LOWCODE_PLACEHOLDER_COLOR,
  DEFAULT_LOWCODE_TEXT_COLOR,
  normalizeLowcodeTextColor
} from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { parseColor } from '#core/color'
import { resolveMapModule, type MapModuleConfig } from '#core/plugins'
import { buttonLabelTextNode, lowcodeTextNode, lowcodeTextProjection } from '#core/text/lowcode'

import type { SkiaRenderer } from './renderer'

export { buttonLabelTextNode, lowcodeTextNode, lowcodeTextProjection }

function configureTextPaint(r: SkiaRenderer, cssColor: string): void {
  const color = parseColor(cssColor)
  r.fillPaint.setShader(null)
  r.fillPaint.setColor(r.color4f(color.r, color.g, color.b, color.a))
  r.fillPaint.setAlphaf(1)
  r.fillPaint.setBlendMode(r.ck.BlendMode.SrcOver)
}

export function renderButtonLabel(r: SkiaRenderer, canvas: Canvas, node: SceneNode): void {
  const label = buttonLabelTextNode(node)
  if (!label) return

  // BUTTON fills describe its background, not its label color. Keep the
  // foreground in interactiveProps so canvas and generated controls agree.
  const color = normalizeLowcodeTextColor(
    node.interactiveProps?.textColor,
    DEFAULT_LOWCODE_TEXT_COLOR
  )
  configureTextPaint(r, color)
  r.renderText(canvas, label)
}

export function renderTextInputContent(r: SkiaRenderer, canvas: Canvas, node: SceneNode): void {
  const projection = lowcodeTextProjection(node)
  if (!projection || projection.contentKind === 'button_label' || projection.node.text === '')
    return

  const placeholder = projection.contentKind.endsWith('_placeholder')
  const color = normalizeLowcodeTextColor(
    node.interactiveProps?.[placeholder ? 'placeholderColor' : 'textColor'],
    placeholder ? DEFAULT_LOWCODE_PLACEHOLDER_COLOR : DEFAULT_LOWCODE_TEXT_COLOR
  )
  configureTextPaint(r, color)

  canvas.save()
  canvas.translate(node.paddingLeft, node.type === 'TEXTAREA' ? node.paddingTop : 0)
  r.renderText(canvas, projection.node)
  canvas.restore()
}

const MAP_PALETTES = {
  standard: {
    background: '#E8F0EC',
    road: '#B7C7D0',
    grid: '#D9E3E8',
    marker: '#E24646',
    center: '#2563EB'
  },
  light: {
    background: '#F8FAFC',
    road: '#CBD5E1',
    grid: '#E2E8F0',
    marker: '#DC2626',
    center: '#2563EB'
  },
  dark: {
    background: '#172033',
    road: '#64748B',
    grid: '#334155',
    marker: '#FB7185',
    center: '#60A5FA'
  }
} as const

function configureMapPaint(r: SkiaRenderer, cssColor: string, strokeWidth?: number): void {
  const color = parseColor(cssColor)
  const paint = strokeWidth === undefined ? r.fillPaint : r.auxStroke
  paint.setShader(null)
  paint.setColor(r.color4f(color.r, color.g, color.b, color.a))
  paint.setAlphaf(1)
  paint.setBlendMode(r.ck.BlendMode.SrcOver)
  if (strokeWidth !== undefined) {
    paint.setStrokeWidth(strokeWidth)
    paint.setPathEffect(null)
  }
}

function mercatorPosition(
  config: MapModuleConfig,
  node: SceneNode,
  lng: number,
  lat: number
): Vector {
  const [centerLng, centerLat] = config.center
  const scale = 256 * 2 ** config.zoom
  const projectY = (value: number) => {
    const bounded = Math.max(-85.051129, Math.min(85.051129, value))
    const radians = (bounded * Math.PI) / 180
    return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2
  }
  let dx = ((lng - centerLng) / 360) * scale
  if (dx > scale / 2) dx -= scale
  else if (dx < -scale / 2) dx += scale
  const dy = (projectY(lat) - projectY(centerLat)) * scale
  return { x: node.width / 2 + dx, y: node.height / 2 + dy }
}

/** Draw a deterministic, offline editor preview for a registered map module. */
export function renderMapModulePreview(r: SkiaRenderer, canvas: Canvas, node: SceneNode): boolean {
  if (node.type !== 'FRAME') return false
  const resolved = resolveMapModule(node.interactiveProps?.module)
  if (!resolved?.ok) return false

  const { config } = resolved
  const palette = MAP_PALETTES[config.style]
  const width = Math.max(0, node.width)
  const height = Math.max(0, node.height)
  if (width === 0 || height === 0) return true

  canvas.save()
  try {
    canvas.clipRRect(r.makeRRect(node), r.ck.ClipOp.Intersect, true)

    configureMapPaint(r, palette.background)
    canvas.drawRect(r.ck.LTRBRect(0, 0, width, height), r.fillPaint)

    configureMapPaint(r, palette.grid, Math.max(0.5, 1 / r.zoom))
    const gridStep = Math.max(24, Math.min(width, height) / 5)
    for (let x = gridStep; x < width; x += gridStep) {
      canvas.drawLine(x, 0, x, height, r.auxStroke)
    }
    for (let y = gridStep; y < height; y += gridStep) {
      canvas.drawLine(0, y, width, y, r.auxStroke)
    }

    configureMapPaint(r, palette.road, Math.max(2, 4 / r.zoom))
    canvas.drawLine(0, height * 0.28, width, height * 0.62, r.auxStroke)
    canvas.drawLine(width * 0.18, 0, width * 0.72, height, r.auxStroke)
    canvas.drawLine(0, height * 0.78, width, height * 0.48, r.auxStroke)

    for (const marker of config.markers) {
      const point = mercatorPosition(config, node, marker.lng, marker.lat)
      if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue
      configureMapPaint(r, palette.marker)
      canvas.drawCircle(point.x, point.y, Math.max(3, 5 / r.zoom), r.fillPaint)
      configureMapPaint(r, '#FFFFFF')
      canvas.drawCircle(point.x, point.y, Math.max(1, 2 / r.zoom), r.fillPaint)
    }

    configureMapPaint(r, palette.center)
    canvas.drawCircle(width / 2, height / 2, Math.max(4, 7 / r.zoom), r.fillPaint)
    configureMapPaint(r, '#FFFFFF')
    canvas.drawCircle(width / 2, height / 2, Math.max(1.5, 3 / r.zoom), r.fillPaint)
  } finally {
    canvas.restore()
  }
  return true
}
