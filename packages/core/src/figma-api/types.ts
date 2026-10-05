import type { MotionVisualState } from '@open-pencil/motion'

import type {
  RasterExportFormat,
  RasterRenderBounds,
  RasterRenderOptions
} from '#core/io/formats/raster'

export type FigmaTransform = [[number, number, number], [number, number, number]]

/** Raster export request; `pageId` names the page holding the nodes (default: the current page). */
export interface ExportImageOptions extends Pick<
  RasterRenderOptions,
  'generatedEffectTimeMs' | 'generatedEffectMode'
> {
  bounds?: RasterRenderBounds
  motionVisualStates?: ReadonlyMap<string, MotionVisualState>
  scale?: number
  format?: RasterExportFormat
  quality?: number
  pageId?: string
}
