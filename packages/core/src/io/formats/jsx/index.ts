import {
  sceneNodeToJSX as designSceneJSX,
  selectionToJSX as designSelectionJSX
} from '@open-pencil/design-jsx'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { sceneNodeToTailwindJSX, selectionToTailwindJSX } from './tailwind'

export type JSXFormat = 'openpencil' | 'tailwind'
export function sceneNodeToJSX(
  id: string,
  graph: SceneGraph,
  format: JSXFormat = 'openpencil'
): string {
  return format === 'tailwind' ? sceneNodeToTailwindJSX(id, graph) : designSceneJSX(id, graph)
}
export function selectionToJSX(
  ids: string[],
  graph: SceneGraph,
  format: JSXFormat = 'openpencil'
): string {
  return format === 'tailwind' ? selectionToTailwindJSX(ids, graph) : designSelectionJSX(ids, graph)
}
export {
  collectLayoutPrimitiveClasses,
  collectResponsiveTailwindClasses,
  collectStateTailwindClasses,
  collectTailwindClasses,
  gradientFillCSS,
  type TailwindClassOptions
} from './tailwind-classes'
