import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText } from '#core/canvas/labels/text'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'

export interface ModulePreviewFrame {
  node: SceneNode
  width: number
  height: number
  empty: boolean
}

interface ModulePreviewResolution<TConfig> {
  ok: true
  config: TConfig
}

export interface ResolvedModulePreviewFrame<TConfig> extends ModulePreviewFrame {
  config: TConfig
}

export interface ModulePreviewMediaLayout {
  inset: number
  footerHeight: number
}

export interface ModulePreviewCellTextOptions {
  horizontalInsetRatio: number
  baselineRatio: number
}

export function modulePreviewFrame(node: SceneNode): ModulePreviewFrame | null {
  if (node.type !== 'FRAME') return null
  const width = Math.max(0, node.width)
  const height = Math.max(0, node.height)
  return { node, width, height, empty: width === 0 || height === 0 }
}

export function resolveModulePreviewFrame<TConfig>(
  node: SceneNode,
  resolve: (value: unknown) => ModulePreviewResolution<TConfig> | { ok: false } | null
): ResolvedModulePreviewFrame<TConfig> | null {
  const frame = modulePreviewFrame(node)
  if (!frame) return null
  const resolved = resolve(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return null
  return { ...frame, config: resolved.config }
}

export function renderResolvedModulePreview<TConfig>(
  node: SceneNode,
  resolve: (value: unknown) => ModulePreviewResolution<TConfig> | { ok: false } | null,
  draw: (frame: ResolvedModulePreviewFrame<TConfig>) => void
): boolean {
  const frame = resolveModulePreviewFrame(node, resolve)
  if (!frame) return false
  if (frame.empty) return true
  draw(frame)
  return true
}

export function modulePreviewMediaLayout(width: number, height: number): ModulePreviewMediaLayout {
  return {
    inset: Math.min(24, Math.max(8, Math.min(width, height) * 0.06)),
    footerHeight: Math.min(34, Math.max(20, height * 0.14))
  }
}

export function withModulePreviewClip(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  draw: () => void
): void {
  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(node), renderer.ck.ClipOp.Intersect, true)
    draw()
  } finally {
    canvas.restore()
  }
}

export function withModulePreviewSurface(
  renderer: SkiaRenderer,
  canvas: Canvas,
  frame: ModulePreviewFrame,
  backgroundColor: string,
  draw: () => void
): void {
  withModulePreviewClip(renderer, canvas, frame.node, () => {
    configureModulePreviewPaint(renderer, backgroundColor)
    canvas.drawRect(renderer.ck.LTRBRect(0, 0, frame.width, frame.height), renderer.fillPaint)
    draw()
  })
}

export function withModulePreviewFont(
  renderer: SkiaRenderer,
  fontSize: number,
  draw: () => void
): void {
  const font = renderer.labelFont
  const previousFontSize = font?.getSize()
  try {
    font?.setSize(fontSize)
    draw()
  } finally {
    if (font && previousFontSize !== undefined) font.setSize(previousFontSize)
  }
}

export function configureModulePreviewPaint(renderer: SkiaRenderer, cssColor: string): void {
  const color = parseColor(cssColor)
  renderer.fillPaint.setShader(null)
  renderer.fillPaint.setColor(renderer.color4f(color.r, color.g, color.b, color.a))
  renderer.fillPaint.setAlphaf(1)
  renderer.fillPaint.setBlendMode(renderer.ck.BlendMode.SrcOver)
}

export function drawModulePreviewLabel(
  renderer: SkiaRenderer,
  canvas: Canvas,
  text: string,
  width: number,
  height: number,
  inset: number,
  color: string
): void {
  const font = renderer.labelFont
  if (!font || height < inset * 2 + 18) return
  configureModulePreviewPaint(renderer, color)
  const label = ellipsizeLabelText(font, text, Math.max(0, width - inset * 2))
  if (!label) return
  canvas.drawText(label, inset, height - Math.max(4, inset * 0.4), renderer.fillPaint, font)
}

export function drawModulePreviewCellText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  value: string,
  left: number,
  top: number,
  width: number,
  rowHeight: number,
  color: string,
  options: ModulePreviewCellTextOptions
): void {
  const font = renderer.labelFont
  if (!font) return
  const inset = Math.min(8, Math.max(3, width * options.horizontalInsetRatio))
  const label = ellipsizeLabelText(font, value, Math.max(0, width - inset * 2))
  if (!label) return
  configureModulePreviewPaint(renderer, color)
  canvas.drawText(
    label,
    left + inset,
    top + rowHeight * options.baselineRatio,
    renderer.fillPaint,
    font
  )
}

export function drawModulePreviewStripedRows(
  renderer: SkiaRenderer,
  canvas: Canvas,
  rowCount: number,
  headerRows: number,
  rowHeight: number,
  width: number,
  bottom: number
): void {
  for (let index = 1; index < rowCount; index += 2) {
    const top = (headerRows + index) * rowHeight
    configureModulePreviewPaint(renderer, '#F9FAFB')
    canvas.drawRect(
      renderer.ck.LTRBRect(0, top, width, Math.min(bottom, top + rowHeight)),
      renderer.fillPaint
    )
  }
}
