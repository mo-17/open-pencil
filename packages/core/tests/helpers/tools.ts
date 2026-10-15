import { SceneGraph } from '@open-pencil/scene-graph'

import { FigmaAPI } from '#core/figma-api'
import { ALL_TOOLS } from '#core/tools/registry'

import { expectDefined } from './assert'

export function setupToolTest() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  return { graph, figma }
}

export function getTool(name: string): (typeof ALL_TOOLS)[number] {
  return expectDefined(
    ALL_TOOLS.find((tool) => tool.name === name),
    `tool ${name}`
  )
}
