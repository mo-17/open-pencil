import {
  lowcodeApplicationShellFrameEligible,
  lowcodeApplicationShellSlotEligible,
  resolveLowcodeApplicationShell,
  validateLowcodeApplication
} from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { applicationDocumentEditable, applicationRawEntry } from '../model'
import type { ApplicationModeEditor, ApplicationModeOption } from '../types'
import type { ApplicationShellView } from './types'

function frameOptions(graph: SceneGraph): ApplicationModeOption[] {
  return graph.getPages().flatMap((page) =>
    graph
      .getChildren(page.id)
      .filter((node) => lowcodeApplicationShellFrameEligible(graph, node.id))
      .map((node) => ({ value: node.id, label: `${page.name} / ${node.name}` }))
  )
}

function slotLabel(graph: SceneGraph, frameNodeId: string, slot: SceneNode): string {
  const names: string[] = []
  const visited = new Set<string>()
  let current: SceneNode | undefined = slot
  while (current && current.id !== frameNodeId && !visited.has(current.id)) {
    names.unshift(current.name)
    visited.add(current.id)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return names.join(' / ')
}

export function applicationShellSlotOptions(
  graph: SceneGraph,
  frameNodeId: string
): ApplicationModeOption[] {
  if (!lowcodeApplicationShellFrameEligible(graph, frameNodeId)) return []
  const options: ApplicationModeOption[] = []
  const visited = new Set<string>([frameNodeId])
  const stack = [...graph.getChildren(frameNodeId)].reverse()
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || visited.has(node.id) || node.type !== 'FRAME') continue
    visited.add(node.id)
    if (lowcodeApplicationShellSlotEligible(graph, frameNodeId, node.id))
      options.push({ value: node.id, label: slotLabel(graph, frameNodeId, node) })
    stack.push(...graph.getChildren(node.id).reverse())
  }
  return options
}

export function readApplicationShell(
  editor: ApplicationModeEditor | undefined
): ApplicationShellView {
  const graph = editor?.graph
  const root = graph?.getNode(graph.rootId)
  const validated = validateLowcodeApplication(root?.lowcodeApplication)
  const inert = root?.pluginData.some((entry) => applicationRawEntry(entry, false)) ?? false
  const shell = validated.ok && !inert ? validated.value.shell : undefined
  return {
    frameNodeId: shell?.frameNodeId ?? '',
    slotNodeId: shell?.slotNodeId ?? '',
    configured: shell !== undefined,
    invalid: !!graph && !!shell && !resolveLowcodeApplicationShell(graph, shell).ok,
    disabled:
      !graph ||
      !applicationDocumentEditable(graph) ||
      inert ||
      !validated.ok ||
      !validated.value.enabled,
    frames: graph ? frameOptions(graph) : []
  }
}
