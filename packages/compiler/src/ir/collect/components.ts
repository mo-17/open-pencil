import { tailwindClassName, type CompilerStyleOptions } from '#compiler/ir/style'
import type { ComponentProp, VariantAxis } from '#compiler/ir/types'

import { parseVariantName, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

/** Phase 3 §8 v2/v3 — the prop(s) a single master descendant is parameterized
 *  by: `text` (`:text` override → `{prop}` content), `className`
 *  (`:fills` override → `className={prop}`), and `style` for token-bound inline
 *  styles that cannot live in Tailwind classes. A child can carry all three. */
export interface ComponentSlot {
  text?: ComponentProp
  className?: ComponentProp
  style?: ComponentProp
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
  /** True when the reusable body contains a prototype source/target or Smart
   * Match key. Every emitted usage then receives its own runtime scope. */
  prototypeBody: boolean
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

/**
 * Phase 3 §8 v6 — classify an override key (`<childId>:<prop>`) into the prop
 * channel it feeds:
 *   - `text`     — `:text`, the only *content* override → a `{prop}` slot.
 *   - `ignore`   — `:name`, a non-visual layer rename → no prop, no inline.
 *   - `className`— EVERYTHING else (fills/strokes/effects/opacity/cornerRadius/
 *                  size/font/layout/padding/grid/borders/…). Every such
 *                  override is fully captured by `tailwindClassName(instChild)`
 *                  (the whole-className recompute v3 introduced), so it routes
 *                  through one `className={prop}` slot.
 * v2 supported only `:text`, v3 added `:fills`; v6 generalizes to all visual
 * overrides — there are no structural overrides (the suffix universe is exactly
 * the per-prop INSTANCE_SYNC keys + the text group), so every instance composes
 * and the old inline fallback for property overrides is gone.
 */
const TEXT_OVERRIDE_SUFFIX = ':text'
const NAME_OVERRIDE_SUFFIX = ':name'
export function overrideKind(key: string): 'text' | 'className' | 'ignore' {
  if (key.endsWith(TEXT_OVERRIDE_SUFFIX)) return 'text'
  if (key.endsWith(NAME_OVERRIDE_SUFFIX)) return 'ignore'
  return 'className'
}

/** An INSTANCE with no overrides renders identically to its master, so it can
 *  be emitted as a bare `<Name />`. */
export function isCleanInstance(node: SceneNode): boolean {
  return node.type === 'INSTANCE' && Object.keys(node.overrides).length === 0
}

/** Phase 3 §8 v4 — true when a COMPONENT is a variant (its parent is a
 *  COMPONENT_SET). Such COMPONENTs are emitted via their SET, not on their own. */
export function isVariantChild(graph: SceneGraph, node: SceneNode): boolean {
  if (node.type !== 'COMPONENT' || !node.parentId) return false
  return graph.getNode(node.parentId)?.type === 'COMPONENT_SET'
}

/** Phase 3 §8 v4/v7 — derive variant axes + cases from a SET's variant children.
 *  Axes = the union of `parseVariantName` keys across all variant children
 *  (first-seen order); each axis's options = the union of its values. Phase 3 §8
 *  v7: the default value is the SET's `componentPropertyDefinitions` VARIANT
 *  default when it names a real option, otherwise the *first* variant's value
 *  for that axis (the v4 fallback). */
function buildVariants(set: SceneNode, kids: SceneNode[]): ComponentMeta['variants'] {
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
  const declaredDefaults = variantDefaultsFromDefinitions(set)
  const axes: VariantAxis[] = axisOrder.map((rawName) => {
    const options = optionsByAxis.get(rawName) ?? []
    const declared = declaredDefaults.get(rawName)
    // §8 v7: honor the declared default only when it is a real option of this
    // axis (a stale definition default would otherwise match no variant case).
    const defaultValue =
      declared !== undefined && options.includes(declared)
        ? declared
        : (first[rawName] ?? options[0])
    return { name: uniqueName(propName(rawName), usedPropNames), rawName, options, defaultValue }
  })
  return { axes, cases: parsed }
}

/** Phase 3 §8 v7 — a COMPONENT_SET's VARIANT-property defaults: axis raw name →
 *  declared default option, from `componentPropertyDefinitions`. Non-VARIANT
 *  props (TEXT/BOOLEAN/INSTANCE_SWAP) are ignored. Empty when the SET declares
 *  none (then `buildVariants` falls back to the first variant). */
function variantDefaultsFromDefinitions(set: SceneNode): Map<string, string> {
  const out = new Map<string, string>()
  for (const def of set.componentPropertyDefinitions) {
    if (def.type === 'VARIANT') out.set(def.name, def.defaultValue)
  }
  return out
}

/**
 * Build the master-id → metadata registry: every COMPONENT node that has at
 * least one INSTANCE somewhere in the document. Components with no instances
 * stay inlined. Names are sanitized PascalCase, de-duplicated. Phase 3 §8 v2:
 * also computes each component's text prop slots — the union of `:text`
 * overrides across all its instances, keyed by the master descendant the
 * override targets (mapped via the instance child's `componentId`).
 */
export function buildComponentRegistry(
  graph: SceneGraph,
  styleOptions: CompilerStyleOptions = {}
): ComponentRegistry {
  const prototypeRuntimeNodeIds = collectPrototypeRuntimeNodeIds(graph)
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
    // Phase 3 §8 v9: instances with a deep override are inlined, not emitted as a
    // ref, so they neither keep the master ref-able nor contribute prop slots.
    const refable = instances.filter((i) => !instanceHasDeepOverride(graph, i))
    if (refable.length === 0) continue
    registry.set(master.id, {
      name: uniqueName(componentName(master.name), usedNames),
      propSlots: buildPropSlots(graph, refable, styleOptions),
      prototypeBody: componentBodyUsesPrototype(graph, master.id, prototypeRuntimeNodeIds)
    })
  }
  // Phase 3 §8 v4: a COMPONENT_SET with ≥1 instanced variant → one component
  // with per-axis variant props.
  for (const set of sets) {
    const kids = graph.getChildren(set.id).filter((c) => c.type === 'COMPONENT')
    // Phase 3 §8 v9: a deep-override variant instance is inlined, so only ref-able
    // instances keep the SET ref-able + feed its prop slots.
    const variantInstances = kids
      .flatMap((k) => instancesByComponent.get(k.id) ?? [])
      .filter((i) => !instanceHasDeepOverride(graph, i))
    if (variantInstances.length === 0) continue
    registry.set(set.id, {
      name: uniqueName(componentName(set.name), usedNames),
      // Phase 3 §8 v5: a SET's text/fill prop slots, merged by layer name so
      // the same logical node across variant subtrees shares one prop.
      propSlots: buildSetPropSlots(graph, kids, variantInstances, styleOptions),
      prototypeBody: componentBodyUsesPrototype(graph, set.id, prototypeRuntimeNodeIds),
      variants: buildVariants(set, kids)
    })
  }
  return registry
}

/** Sources, Smart Match layers, and destinations all require a concrete DOM
 * boundary. Instance clones point back to their master through `componentId`,
 * so retain both ids: the page walk sees the clone while the reusable body
 * walk sees the master node. */
function collectPrototypeRuntimeNodeIds(graph: SceneGraph): ReadonlySet<string> {
  const ids = new Set<string>()
  const add = (node: SceneNode | undefined): void => {
    if (!node) return
    ids.add(node.id)
    if (node.componentId) ids.add(node.componentId)
  }
  for (const node of graph.getAllNodes()) {
    if (node.prototype || node.transitionKey) add(node)
    for (const connection of node.prototype?.connections ?? []) {
      if (connection.action.kind === 'navigate' || connection.action.kind === 'openOverlay') {
        add(graph.getNode(connection.action.targetNodeId))
      }
    }
  }
  return ids
}

function componentBodyUsesPrototype(
  graph: SceneGraph,
  componentId: string,
  runtimeNodeIds: ReadonlySet<string>
): boolean {
  const stack = [...graph.getChildren(componentId)]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || visited.has(node.id)) continue
    visited.add(node.id)
    if (runtimeNodeIds.has(node.id) || (node.componentId && runtimeNodeIds.has(node.componentId))) {
      return true
    }
    stack.push(...graph.getChildren(node.id))
  }
  return false
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
  instances: SceneNode[],
  styleOptions: CompilerStyleOptions = {}
): Map<string, ComponentSlot> {
  // Same override→slot accumulation as a plain component, but keyed by layer
  // name so the same logical node across variant subtrees shares one prop.
  const byName = accumulateSlots(graph, instances, (masterChild) => masterChild.name, styleOptions)
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
function buildPropSlots(
  graph: SceneGraph,
  instances: SceneNode[],
  styleOptions: CompilerStyleOptions = {}
): Map<string, ComponentSlot> {
  // Plain component: one body, so slots are keyed by the master child's node id.
  return accumulateSlots(graph, instances, (masterChild) => masterChild.id, styleOptions)
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
  keyOf: (masterChild: SceneNode) => string,
  styleOptions: CompilerStyleOptions = {}
): Map<string, ComponentSlot> {
  const slots = new Map<string, ComponentSlot>()
  const usedPropNames = new Set<string>()
  for (const instance of instances) {
    for (const key of Object.keys(instance.overrides)) {
      const masterChild = resolveMasterChild(graph, key)
      if (!masterChild) continue
      const kind = overrideKind(key)
      const slotKey = keyOf(masterChild)
      const slot = slots.get(slotKey) ?? {}
      if (kind === 'text' && !slot.text) {
        slot.text = {
          name: uniqueName(propName(masterChild.name), usedPropNames),
          defaultValue: masterChild.text,
          kind: 'text'
        }
      } else if (kind === 'className' && !slot.className) {
        // Phase 3 §8 v6: any non-text visual override (fills/font/size/…) feeds
        // the one className prop — its value is the child's whole recomputed
        // className, so a single slot captures every visual divergence.
        slot.className = {
          name: uniqueName(`${propName(masterChild.name)}ClassName`, usedPropNames),
          defaultValue: tailwindClassName(masterChild, graph, styleOptions),
          kind: 'className'
        }
        slot.style = {
          name: uniqueName(`${propName(masterChild.name)}Style`, usedPropNames),
          defaultValue: '',
          kind: 'style'
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

/**
 * Phase 3 §8 v9 — true when an instance overrides a node that lives INSIDE a
 * nested instance of its component (a "deep" override). The component body emits
 * that nested instance only as a `<Nested/>` ref (a leaf), so a deep override
 * can't be threaded through a usage-site prop — it would be silently dropped.
 * Such an instance is inlined instead (its own clone subtree carries the
 * materialized override values, so it renders correctly), trading reuse for
 * correctness. An override ON the nested instance node itself (its
 * className/text) is NOT deep: it resolves to a node directly in the body and is
 * handled by the normal §8 v2/v3/v6 prop slot.
 */
export function instanceHasDeepOverride(graph: SceneGraph, instance: SceneNode): boolean {
  const rootId = instance.componentId
  if (!rootId) return false
  for (const key of Object.keys(instance.overrides)) {
    const masterChild = resolveMasterChild(graph, key)
    if (!masterChild) continue
    // Walk the master child's ancestors up to the component root; crossing an
    // INSTANCE means the target sits inside a nested instance subtree.
    let cur = masterChild.parentId ? graph.getNode(masterChild.parentId) : undefined
    while (cur && cur.id !== rootId) {
      if (cur.type === 'INSTANCE') return true
      cur = cur.parentId ? graph.getNode(cur.parentId) : undefined
    }
  }
  return false
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
