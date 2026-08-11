import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText, measureLabelText } from '#core/canvas/labels/text'
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

export interface ModulePreviewTriggerOptions {
  width: number
  height: number
  label: string
  showLabel: boolean
  showAccessory: boolean
  accessoryWidth: number
  accessoryHeight: number
  accessoryPosition: 'before' | 'after'
}

export interface ModulePreviewTriggerLayout {
  accessoryLeft: number
  accessoryPosition: 'before' | 'after'
  accessoryScale: number
  centerY: number
  font: SkiaRenderer['labelFont']
  label: string
  labelLeft: number
  showAccessory: boolean
}

interface ModulePreviewTriggerConfig {
  triggerLabel: string
  showTriggerLabel: boolean
  showTriggerIcon?: boolean
  showTriggerChevron?: boolean
}

interface ModulePreviewTriggerAccessory {
  width: number
  height: number
  position: 'before' | 'after'
  visibility: 'icon' | 'chevron'
  draw: (
    renderer: SkiaRenderer,
    canvas: Canvas,
    left: number,
    centerY: number,
    scale: number
  ) => void
}

type ModulePreviewTriggerColors = readonly [background: string, foreground: string]

const MODULE_TRIGGER_CONTENT_GAP = 8
const MODULE_TRIGGER_LABEL_MIN_HEIGHT = 14
const MODULE_TRIGGER_LABEL_BASELINE_OFFSET = 4

function fitModulePreviewTriggerLabel(
  font: NonNullable<SkiaRenderer['labelFont']>,
  value: string,
  maximumWidth: number
): string {
  if (maximumWidth <= 0) return ''
  const label = ellipsizeLabelText(font, value, maximumWidth)
  return measureLabelText(font, label) <= maximumWidth ? label : ''
}

export function layoutModulePreviewTrigger(
  renderer: SkiaRenderer,
  options: ModulePreviewTriggerOptions
): ModulePreviewTriggerLayout {
  const responsiveInset = Math.max(6, Math.min(options.width, options.height) * 0.16)
  const inset = Math.min(12, responsiveInset)
  const availableWidth = options.width > inset * 2 ? options.width - inset * 2 : 0
  const verticalScale = (options.height - 4) / options.accessoryHeight
  const horizontalScale = availableWidth / options.accessoryWidth
  const accessoryScale = Math.max(0, Math.min(1, verticalScale, horizontalScale))
  const showAccessory = options.showAccessory && accessoryScale >= 0.5
  const accessoryWidth = showAccessory ? options.accessoryWidth * accessoryScale : 0
  const font =
    options.showLabel && options.height >= MODULE_TRIGGER_LABEL_MIN_HEIGHT
      ? renderer.labelFont
      : null
  const proposedGap = showAccessory && font ? MODULE_TRIGGER_CONTENT_GAP * accessoryScale : 0
  const label = font
    ? fitModulePreviewTriggerLabel(
        font,
        options.label,
        availableWidth - accessoryWidth - proposedGap
      )
    : ''
  const labelWidth = font && label ? measureLabelText(font, label) : 0
  const gap = showAccessory && label ? proposedGap : 0
  const contentLeft = (options.width - accessoryWidth - gap - labelWidth) / 2
  const accessoryBefore = options.accessoryPosition === 'before'
  return {
    accessoryLeft: accessoryBefore ? contentLeft : contentLeft + labelWidth + gap,
    accessoryPosition: options.accessoryPosition,
    accessoryScale,
    centerY: options.height / 2,
    font,
    label,
    labelLeft: accessoryBefore ? contentLeft + accessoryWidth + gap : contentLeft,
    showAccessory
  }
}

export function drawModulePreviewTrigger(
  renderer: SkiaRenderer,
  canvas: Canvas,
  layout: ModulePreviewTriggerLayout,
  color: string,
  drawAccessory: (left: number, centerY: number, scale: number) => void
): void {
  const hasLabel = Boolean(layout.font && layout.label)
  if (!layout.showAccessory && !hasLabel) return
  configureModulePreviewPaint(renderer, color)
  const drawResolvedAccessory = () => {
    if (layout.showAccessory) {
      drawAccessory(layout.accessoryLeft, layout.centerY, layout.accessoryScale)
    }
  }
  if (layout.accessoryPosition === 'before') drawResolvedAccessory()
  if (layout.font && layout.label) {
    canvas.drawText(
      layout.label,
      layout.labelLeft,
      layout.centerY + MODULE_TRIGGER_LABEL_BASELINE_OFFSET,
      renderer.fillPaint,
      layout.font
    )
  }
  if (layout.accessoryPosition === 'after') drawResolvedAccessory()
}

function createModulePreviewAccessory(
  width: number,
  height: number,
  position: 'before' | 'after',
  visibility: 'icon' | 'chevron',
  draw: ModulePreviewTriggerAccessory['draw']
): ModulePreviewTriggerAccessory {
  return { width, height, position, visibility, draw }
}

export function createModulePreviewIconAccessory(
  width: number,
  height: number,
  draw: ModulePreviewTriggerAccessory['draw']
): ModulePreviewTriggerAccessory {
  return createModulePreviewAccessory(width, height, 'before', 'icon', draw)
}

export function createModulePreviewChevronAccessory(
  width: number,
  height: number,
  draw: ModulePreviewTriggerAccessory['draw']
): ModulePreviewTriggerAccessory {
  return createModulePreviewAccessory(width, height, 'after', 'chevron', draw)
}

export function createModulePreviewTriggerRenderer<TConfig extends ModulePreviewTriggerConfig>(
  resolve: (value: unknown) => ModulePreviewResolution<TConfig> | { ok: false } | null,
  accessory: ModulePreviewTriggerAccessory,
  colors: (config: TConfig) => ModulePreviewTriggerColors
): (renderer: SkiaRenderer, canvas: Canvas, node: SceneNode) => boolean {
  return (renderer, canvas, node) =>
    renderResolvedModulePreview(node, resolve, (frame) => {
      if (frame.node.childIds.length > 0) return
      const showAccessory =
        accessory.visibility === 'icon'
          ? frame.config.showTriggerIcon === true
          : frame.config.showTriggerChevron === true
      const layout = layoutModulePreviewTrigger(renderer, {
        width: frame.width,
        height: frame.height,
        label: frame.config.triggerLabel,
        showLabel: frame.config.showTriggerLabel,
        showAccessory,
        accessoryWidth: accessory.width,
        accessoryHeight: accessory.height,
        accessoryPosition: accessory.position
      })
      const [background, foreground] = colors(frame.config)
      withModulePreviewSurface(renderer, canvas, frame, background, () => {
        drawModulePreviewTrigger(renderer, canvas, layout, foreground, (left, centerY, scale) => {
          accessory.draw(renderer, canvas, left, centerY, scale)
        })
      })
    })
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
