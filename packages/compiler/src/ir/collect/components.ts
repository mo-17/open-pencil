import { parseVariantName, type SceneGraph, type SceneNode } from '@open-pencil/core/scene-graph'

import { tailwindClassName } from '#compiler/ir/style'
import type { ComponentProp, VariantAxis } from '#compiler/ir/types'

/** Phase 3 §8 v2/v3 — the prop(s) a single master descendant is parameterized
 *  by: `text` (`:text` override → `{prop}` content) and/or `className`
 *  (`:fills` override → `className={prop}`). A child can carry both. */
export interface ComponentSlot {
  text?: ComponentProp
  className?: ComponentProp
}

/**
 * Phase 3 §8 — per-master metadata for the components extracted from a compile.
 * `name` is the PascalCase React component name; `propSlots` (Phase 3 §8 v2/v3)
 * maps a master *descendant* node id to the prop(s) it is parameterized by, so
 * the component body emits `{prop}` / `className={prop}` there and each instance
 * passes its overridden value. Built once per compile (components are
 * page-agnostic).
 */
export interface ComponentMeta {
  name: string
  /** master-descendant node id → prop slot (empty when no instance overrides
   *  a supported prop on this component). */
  propSlots: Map<string, ComponentSlot>
  /** Phase 3 §8 v4 — set when this is a COMPONENT_SET: the variant axes and the
   *  per-variant cases (each a COMPONENT child of the SET, keyed by its
   *  parsed variant values). Plain components leave this undefined. */
  variants?: {
    axes: VariantAxis[]
    cases: { childId: string; values: Record<string, string> }[]
  }
}

/** master COMPONENT node id → its emit metadata. */
export type ComponentRegistry = Map<string, ComponentMeta>

/** The override suffixes §8 maps to props: `:text` (v2, content) and `:fills`
 *  (v3, className). Any other override → inline fallback. */
const TEXT_OVERRIDE_SUFFIX = ':text'
const FILLS_OVERRIDE_SUFFIX = ':fills'

/** An INSTANCE with no overrides renders identically to its master, so it can
 *  be emitted as a bare `<Name />`. */
export function isCleanInstance(node: SceneNode): boolean {
  return node.type === 'INSTANCE' && Object.keys(node.overrides).length === 0
}

/** Phase 3 §8 v2/v3 — true when every override an instance carries is a
 *  supported one (`:text` → text prop, `:fills` → className prop), so the whole
 *  instance can be emitted as `<Name title=.. badgeClassName=.. />`. An empty
 *  override set is trivially supported (a clean instance). */
export function isSupportedOverrideInstance(node: SceneNode): boolean {
  if (node.type !== 'INSTANCE') return false
  return Object.keys(node.overrides).every(
    (key) => key.endsWith(TEXT_OVERRIDE_SUFFIX) || key.endsWith(FILLS_OVERRIDE_SUFFIX)
  )
}

/** Phase 3 §8 v4 — true when a COMPONENT is a variant (its parent is a
 *  COMPONENT_SET). Such COMPONENTs are emitted via their SET, not on their own. */
export function isVariantChild(graph: SceneGraph, node: SceneNode): boolean {
  if (node.type !== 'COMPONENT' || !node.parentId) return false
  return graph.getNode(node.parentId)?.type === 'COMPONENT_SET'
}

/** Phase 3 §8 v4 — derive variant axes + cases from a SET's variant children.
 *  Axes = the union of `parseVariantName` keys across all variant children
 *  (first-seen order); each axis's options = the union of its values; the
 *  default value is the *first* variant's value for that axis (deterministic,
 *  independent of the SET's componentPropertyDefinitions). */
function buildVariants(kids: SceneNode[]): ComponentMeta['variants'] {
  const parsed = kids.map((kid) => ({ childId: kid.id, values: parseVariantName(kid.name) }))
  const axisOrder: string[] = []
  const optionsByAxis = new Map<string, string[]>()
  for (const { values } of parsed) {
    for (const [rawName, value] of Object.entries(values)) {
      if (!optionsByAxis.has(rawName)) {
        axisOrder.push(rawName)
        optionsByAxis.set(rawName, [])
      }
      const opts = optionsByAxis.get(rawName)
      if (opts && !opts.includes(value)) opts.push(value)
    }
  }
  const usedPropNames = new Set<string>()
  const first = parsed[0]?.values ?? {}
  const axes: VariantAxis[] = axisOrder.map((rawName) => ({
    name: uniqueName(propName(rawName), usedPropNames),
    rawName,
    options: optionsByAxis.get(rawName) ?? [],
    defaultValue: first[rawName] ?? (optionsByAxis.get(rawName)?.[0] ?? '')
  }))
  return { axes, cases: parsed }
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
  const sets: SceneNode[] = []
  for (const node of graph.getAllNodes()) {
    if (node.type === 'INSTANCE' && node.componentId) {
      const list = instancesByComponent.get(node.componentId) ?? []
      list.push(node)
      instancesByComponent.set(node.componentId, list)
    } else if (node.type === 'COMPONENT') {
      // Phase 3 §8 v4: a variant child (parent is a COMPONENT_SET) is emitted
      // as part of its SET's one component, not on its own.
      if (!isVariantChild(graph, node)) masters.push(node)
    } else if (node.type === 'COMPONENT_SET') {
      sets.push(node)
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
  // Phase 3 §8 v4: a COMPONENT_SET with ≥1 instanced variant → one component
  // with per-axis variant props.
  for (const set of sets) {
    const kids = graph.getChildren(set.id).filter((c) => c.type === 'COMPONENT')
    if (!kids.some((k) => (instancesByComponent.get(k.id)?.length ?? 0) > 0)) continue
    const variantInstances = kids.flatMap((k) => instancesByComponent.get(k.id) ?? [])
    registry.set(set.id, {
      name: uniqueName(componentName(set.name), usedNames),
      // Phase 3 §8 v5: a SET's text/fill prop slots, merged by layer name so
      // the same logical node across variant subtrees shares one prop.
      propSlots: buildSetPropSlots(graph, kids, variantInstances),
      variants: buildVariants(kids)
    })
  }
  return registry
}

/** Phase 3 §8 v5 — prop slots for a COMPONENT_SET. Unlike a plain component
 *  (one body, node-id-keyed), a SET has one body per variant child, and the
 *  same logical node (same layer name) recurs across them. So slots are merged
 *  by *name*: each `:text` / `:fills` override across all variant instances
 *  contributes one prop (named from the layer), then every variant
 *  descendant with that name is keyed onto the shared slot, so each variant
 *  subtree emits `{prop ?? ownLiteral}` at its corresponding node. */
function buildSetPropSlots(
  graph: SceneGraph,
  variantKids: SceneNode[],
  instances: SceneNode[]
): Map<string, ComponentSlot> {
  // Same override→slot accumulation as a plain component, but keyed by layer
  // name so the same logical node across variant subtrees shares one prop.
  const byName = accumulateSlots(graph, instances, (masterChild) => masterChild.name)
  // Fan the name-keyed slots back out to every variant descendant id so the
  // walker (which looks up by node id) parameterizes the matching node in
  // every variant subtree, not just the one an instance happened to override.
  const slots = new Map<string, ComponentSlot>()
  if (byName.size === 0) return slots
  for (const kid of variantKids) {
    for (const descendant of descendantsOf(graph, kid.id)) {
      const slot = byName.get(descendant.name)
      if (slot) slots.set(descendant.id, slot)
    }
  }
  return slots
}

/** Every descendant of `parentId` (excluding the parent itself), depth-first. */
function descendantsOf(graph: SceneGraph, parentId: string): SceneNode[] {
  const out: SceneNode[] = []
  const stack = [...graph.getChildren(parentId)]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    out.push(node)
    stack.push(...graph.getChildren(node.id))
  }
  return out
}

/** Phase 3 §8 v2/v3 — the union of prop slots across a master's instances.
 *  Each supported override key (`<instChildId>:text` / `:fills`) is mapped to
 *  the master descendant it targets (the instance child's `componentId`), so
 *  all instances overriding the "same" child collapse onto one slot. A `:text`
 *  override adds a content prop (default = master text); a `:fills` override
 *  adds a className prop (default = master child's Tailwind classes). A child
 *  can carry both. */
function buildPropSlots(graph: SceneGraph, instances: SceneNode[]): Map<string, ComponentSlot> {
  // Plain component: one body, so slots are keyed by the master child's node id.
  return accumulateSlots(graph, instances, (masterChild) => masterChild.id)
}

/** The shared slot accumulator for §8 v2/v3 (and v5). Walks every supported
 *  override across `instances`, resolves the master descendant it targets, and
 *  builds a `:text` (content) / `:fills` (className) prop slot keyed by
 *  `keyOf(masterChild)` — the node id for a plain component (one body) or the
 *  layer name for a COMPONENT_SET (one shared prop across variant subtrees).
 *  Prop names are derived from the layer name and de-duplicated. */
function accumulateSlots(
  graph: SceneGraph,
  instances: SceneNode[],
  keyOf: (masterChild: SceneNode) => string
): Map<string, ComponentSlot> {
  const slots = new Map<string, ComponentSlot>()
  const usedPropNames = new Set<string>()
  for (const instance of instances) {
    for (const key of Object.keys(instance.overrides)) {
      const masterChild = resolveMasterChild(graph, key)
      if (!masterChild) continue
      const slotKey = keyOf(masterChild)
      const slot = slots.get(slotKey) ?? {}
      if (key.endsWith(TEXT_OVERRIDE_SUFFIX) && !slot.text) {
        slot.text = {
          name: uniqueName(propName(masterChild.name), usedPropNames),
          defaultValue: masterChild.text,
          kind: 'text'
        }
      } else if (key.endsWith(FILLS_OVERRIDE_SUFFIX) && !slot.className) {
        slot.className = {
          name: uniqueName(`${propName(masterChild.name)}ClassName`, usedPropNames),
          defaultValue: tailwindClassName(masterChild, graph),
          kind: 'className'
        }
      }
      slots.set(slotKey, slot)
    }
  }
  return slots
}

/** Map an override key (`<instChildId>:<prop>`) to the master descendant it
 *  targets, via the instance child's `componentId`. Null for unknown nodes. */
function resolveMasterChild(graph: SceneGraph, overrideKey: string): SceneNode | null {
  const colon = overrideKey.lastIndexOf(':')
  if (colon === -1) return null
  const instChild = graph.getNode(overrideKey.slice(0, colon))
  const masterChildId = instChild?.componentId
  return (masterChildId && graph.getNode(masterChildId)) || null
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
