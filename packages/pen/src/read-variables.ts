import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { PenNode, VarContext } from './convert'

export function applyPenTheme(theme: Record<string, string>, ctx: VarContext): void {
  const themeName = Object.values(theme)[0]
  if (themeName) ctx.setActiveTheme(themeName)
}

function resolveNodeVariable(
  node: SceneNode,
  key: string,
  varId: string,
  graph: SceneGraph,
  ctx: VarContext
): void {
  const variable = graph.variables.get(varId)
  if (!variable) return
  const modeVal = variable.valuesByMode[ctx.activeModeId] ?? Object.values(variable.valuesByMode)[0]
  if (key.startsWith('fills[') && typeof modeVal === 'object' && 'r' in modeVal) {
    const index = Number.parseInt(key.match(/\d+/)?.[0] ?? '0', 10)
    if (node.fills[index]) node.fills[index].color = modeVal
  } else if (key.startsWith('strokes[') && typeof modeVal === 'object' && 'r' in modeVal) {
    const index = Number.parseInt(key.match(/\d+/)?.[0] ?? '0', 10)
    if (node.strokes[index]) node.strokes[index].color = modeVal
  }
}

function resolveNodeVars(root: SceneNode, graph: SceneGraph, ctx: VarContext): void {
  const pending = [root]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node || visited.has(node.id)) continue
    visited.add(node.id)
    for (const [key, varId] of Object.entries(node.boundVariables)) {
      resolveNodeVariable(node, key, varId, graph, ctx)
    }
    for (const childId of node.childIds) {
      const child = graph.getNode(childId)
      if (child) pending.push(child)
    }
  }
}

export function resolveThemeVariables(
  penNodes: PenNode[],
  graph: SceneGraph,
  ctx: VarContext
): void {
  for (const pen of penNodes) {
    if (pen.theme) applyPenTheme(pen.theme, ctx)
    const node = graph.getNode(pen.id)
    if (node) resolveNodeVars(node, graph, ctx)
    if (pen.children) resolveThemeVariables(pen.children, graph, ctx)
  }
}
