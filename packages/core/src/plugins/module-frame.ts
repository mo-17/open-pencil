import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

interface ModuleFrameOptions {
  name: string
  defaultSize: Readonly<Pick<SceneNode, 'width' | 'height'>>
  fillColor: Color
  strokeColor: Color
  module: ModuleInstanceV1
}

export function createModuleFrameOverrides(options: ModuleFrameOptions): Partial<SceneNode> {
  return {
    name: options.name,
    width: options.defaultSize.width,
    height: options.defaultSize.height,
    fills: [{ type: 'SOLID', color: options.fillColor, opacity: 1, visible: true }],
    strokes: [
      {
        color: options.strokeColor,
        weight: 1,
        opacity: 1,
        visible: true,
        align: 'INSIDE'
      }
    ],
    cornerRadius: 8,
    clipsContent: true,
    interactiveProps: { module: options.module }
  }
}
