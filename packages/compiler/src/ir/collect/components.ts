import type { SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

import type { ComponentProp } from '#compiler/ir/types'

/**
 * Phase 3 §8 — per-master metadata for the components extracted from a compile.
 * `name` is the PascalCase React component name; `propSlots` (Phase 3 §8 v2)
 * maps a master *descendant* node id to the text prop it is parameterized by,
 * so the component body emits `{prop}` there and each instance passes its
 * overridden value. Built once per compile (components are page-agnostic).
 */
export interface ComponentMeta {
  name: string
  /** master-descendant node id → text prop slot (empty when no instance
   *  overrides text on this component). */
  propSlots: Map<string, ComponentProp>
}

/** master COMPONENT node id → its emit metadata. */
export type ComponentRegistry = Map<string, ComponentMeta>

/** The `:text` override suffix — the only override kind §8 v2 maps to a prop. */
const TEXT_OVERRIDE_SUFFIX = ':text'

/** An INSTANCE with no overrides renders identically to its master, so it can
 *  be emitted as a bare `<Name />`. Any override means the clone diverged from
 *  the master. Phase 3 §8 v2 lifts text-only divergence into props
 *  (`isTextOnlyInstance`); other overrides still fall back to inlining. */
export function isCleanInstance(node: SceneNode): boolean {
  return node.type === 'INSTANCE' && Object.keys(node.overrides).length === 0
}

/** Phase 3 §8 v2 — true when every override an instance carries is a `:text`
 *  override (so the whole instance can be emitted as `<Name title=.. />`).
 *  An empty override set is trivially text-only (a clean instance). */
export function isTextOnlyInstance(node: SceneNode): boolean {
  if (node.type !== 'INSTANCE') return false
  return Object.keys(node.overrides).every((key) => key.endsWith(TEXT_OVERRIDE_SUFFIX))
}

/**
 * Build the master-id → metadata registry: every COMPONENT node that has at
 * least one INSTANCE somewhere in the document. Components with no instances
 * stay inlined. Names are sanitized PascalCase, de-duplicated. Phase 3 §8 v2:
 * also computes each component's text prop slots — the union of `:text`
 * overrides across all its instances, keyed by the master descendant the
 * override targets (mapped via the instance child's `componentId`).
 */
export function buildComponentRegistry(graph: SceneGraph): ComponentRegistry {
  const instancesByComponent = new Map<string, SceneNode[]>()
  const masters: SceneNode[] = []
  for (const node of graph.getAllNodes()) {
    if (node.type === 'INSTANCE' && node.componentId) {
      const list = instancesByComponent.get(node.componentId) ?? []
      list.push(node)
      instancesByComponent.set(node.componentId, list)
    } else if (node.type === 'COMPONENT') {
      masters.push(node)
    }
  }

  const registry: ComponentRegistry = new Map()
  const usedNames = new Set<string>()
  for (const master of masters) {
    const instances = instancesByComponent.get(master.id)
    if (!instances || instances.length === 0) continue
    registry.set(master.id, {
      name: uniqueName(componentName(master.name), usedNames),
      propSlots: buildPropSlots(graph, instances)
    })
  }
  return registry
}

/** Phase 3 §8 v2 — the union of text prop slots across a master's instances.
 *  Each `:text` override key (`<instChildId>:text`) is mapped to the master
 *  descendant it targets (the instance child's `componentId`), so all
 *  instances overriding the "same" child collapse onto one prop. The prop's
 *  default is the master descendant's own text. */
function buildPropSlots(graph: SceneGraph, instances: SceneNode[]): Map<string, ComponentProp> {
  const slots = new Map<string, ComponentProp>()
  const usedPropNames = new Set<string>()
  for (const instance of instances) {
    for (const key of Object.keys(instance.overrides)) {
      if (!key.endsWith(TEXT_OVERRIDE_SUFFIX)) continue
      const instChildId = key.slice(0, -TEXT_OVERRIDE_SUFFIX.length)
      const instChild = graph.getNode(instChildId)
      const masterChildId = instChild?.componentId
      if (!masterChildId || slots.has(masterChildId)) continue
      const masterChild = graph.getNode(masterChildId)
      if (!masterChild) continue
      slots.set(masterChildId, {
        name: uniqueName(propName(masterChild.name), usedPropNames),
        defaultValue: masterChild.text
      })
    }
  }
  return slots
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

/** Turn a layer name into a camelCase prop identifier (first word lowercased).
 *  Empty / leading-digit results fall back to `text`. */
function propName(rawName: string): string {
  const words = rawName.split(/[^a-zA-Z0-9]+/).filter((w) => w !== '')
  const camel = words
    .map((w, i) =>
      i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join('')
  if (camel === '' || /^[0-9]/.test(camel)) return 'text'
  return camel
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base
  let n = 2
  while (used.has(name)) name = `${base}${n++}`
  used.add(name)
  return name
}
