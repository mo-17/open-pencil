import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  CODE_BLOCK_MODULE_TYPE,
  CODE_BLOCK_PLUGIN_ID,
  resolveCodeBlockModule
} from '#core/plugins/code-block'

import { drawCodeBlockHeader, drawCodeBlockLines } from './code-block/draw'
import { renderResolvedModulePreview, withModulePreviewSurface } from './preview'
import type { ModuleCanvasAdapter } from './types'

export function codeBlockPreviewLines(code: string, maximumLines: number): string[] {
  return code.split(/\r\n|\r|\n/).slice(0, Math.max(0, maximumLines))
}

/** Authored source stays inert; the design canvas never accesses the clipboard. */
export function renderCodeBlockModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveCodeBlockModule, (frame) => {
    withModulePreviewSurface(renderer, canvas, frame, frame.config.backgroundColor, () => {
      drawCodeBlockHeader(renderer, canvas, frame)
      drawCodeBlockLines(renderer, canvas, frame)
    })
  })
}

export const CODE_BLOCK_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: CODE_BLOCK_PLUGIN_ID,
  moduleType: CODE_BLOCK_MODULE_TYPE,
  render: renderCodeBlockModulePreview
})
