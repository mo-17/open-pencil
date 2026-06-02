import type { SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

/**
 * Phase 3 §8 — maps a COMPONENT master node id to the PascalCase React
 * component name it is emitted as. Built once per compile (components are
 * page-agnostic, reusable across pages) and threaded into both the page walk
 * and the component-body collection so a master and its clean instances all
 * resolve to the same `<Name />`.
 */
export type ComponentRegistry = Map<string, string>

/** An INSTANCE with no overrides renders identically to its master, so it can
 *  be emitted as a bare `<Name />`. Any override means the clone diverged from
 *  the master → fall back to inlining the subtree to stay faithful (v1). */
export function isCleanInstance(node: SceneNode): boolean {
  return node.type === 'INSTANCE' && Object.keys(node.overrides).length === 0
}

/**
 * Build the master-id → component-name registry: every COMPONENT node that has
 * at least one INSTANCE somewhere in the document. Components with no instances
 * stay inlined (extraction would only add an unused file). Names are derived
 * from the master's `name`, sanitized to a valid PascalCase identifier and
 * de-duplicated with a numeric suffix.
 */
export function buildComponentRegistry(graph: SceneGraph): ComponentRegistry {
  const instancedComponentIds = new Set<string>()
  const masters: SceneNode[] = []
  for (const node of graph.getAllNodes()) {
    if (node.type === 'INSTANCE' && node.componentId) instancedComponentIds.add(node.componentId)
    else if (node.type === 'COMPONENT') masters.push(node)
  }

  const registry: ComponentRegistry = new Map()
  const usedNames = new Set<string>()
  for (const master of masters) {
    if (!instancedComponentIds.has(master.id)) continue
    registry.set(master.id, uniqueName(componentName(master.name), usedNames))
  }
  return registry
}

/** Turn a layer name into a valid PascalCase identifier. Non-alphanumeric runs
 *  become word breaks; a leading digit (or empty result) falls back to a
 *  `Component`-prefixed name so the emitted symbol is always a legal default
 *  export. */
function componentName(rawName: string): string {
  const words = rawName.split(/[^a-zA-Z0-9]+/).filter((w) => w !== '')
  const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  if (pascal === '' || /^[0-9]/.test(pascal)) return `Component${pascal}`
  return pascal
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base
  let n = 2
  while (used.has(name)) name = `${base}${n++}`
  used.add(name)
  return name
}
