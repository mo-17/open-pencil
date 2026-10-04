import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { drawModuleLabel, moduleLabelTextNode } from '#core/canvas/modules/label'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewSurface,
  type ModulePreviewResolution
} from '#core/canvas/modules/preview'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { modalHidesContent } from '#core/plugins/content/modal'

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
  labelWidth: number
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

function measureTriggerLabel(
  renderer: SkiaRenderer,
  host: SceneNode,
  value: string,
  maximumWidth: number
): number {
  if (maximumWidth <= 0 || !renderer.labelFont) return 0
  const label = moduleLabelTextNode(
    host,
    value,
    maximumWidth,
    renderer.labelFont.getSize(),
    host.textLanguage ?? 'en'
  )
  return Math.min(maximumWidth, renderer.measureTextNode(label, maximumWidth)?.width ?? 0)
}

export function layoutModulePreviewTrigger(
  renderer: SkiaRenderer,
  host: SceneNode,
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
  const labelWidth = font
    ? measureTriggerLabel(
        renderer,
        host,
        options.label,
        availableWidth - accessoryWidth - proposedGap
      )
    : 0
  const label = labelWidth > 0 ? options.label : ''
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
    labelWidth,
    labelLeft: accessoryBefore ? contentLeft + accessoryWidth + gap : contentLeft,
    showAccessory
  }
}

export function drawModulePreviewTrigger(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
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
    drawModuleLabel(renderer, canvas, host, {
      text: layout.label,
      x: layout.labelLeft,
      baseline: layout.centerY + MODULE_TRIGGER_LABEL_BASELINE_OFFSET,
      maxWidth: layout.labelWidth,
      color,
      locale: host.textLanguage ?? 'en'
    })
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
      if (frame.node.childIds.length > 0 && !modalHidesContent(frame.node)) return
      const showAccessory =
        accessory.visibility === 'icon'
          ? frame.config.showTriggerIcon === true
          : frame.config.showTriggerChevron === true
      const layout = layoutModulePreviewTrigger(renderer, node, {
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
        drawModulePreviewTrigger(
          renderer,
          canvas,
          node,
          layout,
          foreground,
          (left, centerY, scale) => {
            accessory.draw(renderer, canvas, left, centerY, scale)
          }
        )
      })
    })
}
