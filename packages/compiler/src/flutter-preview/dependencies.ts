import { FLUTTER_PREVIEW_SNAPSHOT_LIMITS as LIMITS, invalidFlutterPreviewSnapshot } from './limits'
import type { FlutterPreviewJSONNode } from './snapshot'

/** Reference graphs are flat JSON, so their expansion depth needs a separate budget. */
export function validatePreviewDependencies(dependencies: Map<string, Set<string>>): void {
  const heights = new Map<string, number>()
  const visiting = new Set<string>()
  for (const start of dependencies.keys()) {
    const pending = [{ id: start, targets: [...(dependencies.get(start) ?? [])], height: 0 }]
    while (pending.length) {
      if (pending.length > LIMITS.maxDepth + 1) return invalidFlutterPreviewSnapshot()
      const current = pending[pending.length - 1]
      visiting.add(current.id)
      const next = current.targets.pop()
      if (next !== undefined) {
        if (visiting.has(next)) return invalidFlutterPreviewSnapshot()
        const height = heights.get(next)
        if (height !== undefined) current.height = Math.max(current.height, height + 1)
        else pending.push({ id: next, targets: [...(dependencies.get(next) ?? [])], height: 0 })
      } else {
        if (current.height > LIMITS.maxDepth) return invalidFlutterPreviewSnapshot()
        heights.set(current.id, current.height)
        visiting.delete(current.id)
        pending.pop()
        if (pending.length) {
          const parent = pending[pending.length - 1]
          parent.height = Math.max(parent.height, current.height + 1)
        }
      }
    }
  }
}

export function validatePreviewComponents(nodes: Map<string, FlutterPreviewJSONNode>): void {
  const dependencies = new Map<string, Set<string>>()
  for (const node of nodes.values()) {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')
      dependencies.set(node.id, new Set())
  }
  for (const node of nodes.values()) {
    let parent = node.parentId ? nodes.get(node.parentId) : undefined
    while (parent && !dependencies.has(parent.id))
      parent = parent.parentId ? nodes.get(parent.parentId) : undefined
    if (!parent) continue
    if (node.type === 'INSTANCE' && node.componentId)
      dependencies.get(parent.id)?.add(node.componentId)
    else if (dependencies.has(node.id)) dependencies.get(parent.id)?.add(node.id)
  }
  validatePreviewDependencies(dependencies)
}
