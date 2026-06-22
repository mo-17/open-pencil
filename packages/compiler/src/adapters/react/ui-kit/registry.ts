import type { IRNode } from '#compiler/ir/types'
import type { CompilerOptions } from '#compiler/types'

import { shadcnAdapter } from './shadcn'
import type { UiKitAdapter, UiKitMapping } from './types'

const ADAPTERS: Partial<Record<string, UiKitAdapter>> = {
  shadcn: shadcnAdapter
}

/** Phase 3 §15 — resolve the configured UI kit, or null when unset/unknown
 *  (→ the self-contained Tailwind emit, byte-identical to pre-§15 output). */
export function resolveUiKit(options: CompilerOptions): UiKitAdapter | null {
  const name = options.uiKit
  if (name === undefined) return null
  return ADAPTERS[name] ?? null
}

/**
 * Walk an IR subtree collecting the kit imports each interactive node needs.
 * Returns the unique `{ component, from }` mappings (sorted by component) so a
 * file can emit one import line each. Pure — mirrors `referencedComponentNames`.
 */
export function collectKitImports(nodes: readonly IRNode[], kit: UiKitAdapter): UiKitMapping[] {
  const byComponent = new Map<string, UiKitMapping>()
  for (const node of nodes) walkForKit(node, kit, byComponent)
  return [...byComponent.values()].sort((a, b) => a.component.localeCompare(b.component))
}

/** Collect just the used component names across an IR subtree (for emit + deps). */
export function collectUsedKitComponents(
  nodes: readonly IRNode[],
  kit: UiKitAdapter,
  acc: Set<string> = new Set<string>()
): Set<string> {
  for (const node of nodes) walkForKit(node, kit, undefined, acc)
  return acc
}

/** Phase 3 §15 — one ES import line for a kit mapping. A composed control
 *  pulls several named exports from one module (`imports`); a Phase A 1:1
 *  component pulls just its own name. */
export function kitImportLine(m: UiKitMapping): string {
  const names = m.imports ? [...m.imports].join(', ') : m.component
  return `import { ${names} } from '${m.from}'`
}

function walkForKit(
  node: IRNode,
  kit: UiKitAdapter,
  imports?: Map<string, UiKitMapping>,
  names?: Set<string>
): void {
  if (node.kind === 'conditional') {
    walkForKit(node.consequent, kit, imports, names)
    return
  }
  if (node.kind === 'list') {
    walkForKit(node.template, kit, imports, names)
    return
  }
  if (node.kind !== 'element') return
  collectContainerMapping(node, kit, imports, names)
  collectDisplayMapping(node, kit, imports, names)
  // Phase 3 §15 Phase B: a marked form control resolves via `mapControl`
  // (identified by its semantic `controlKind`, not its HTML tag); everything
  // else resolves via `mapTag` (Phase A 1:1 tags). A control's plain-HTML
  // children (the SELECT's `<option>`s, the RADIO wrapper's `<label>`s) are
  // subsumed by the composed component — don't also collect them.
  const mapping =
    node.controlKind && kit.mapControl
      ? kit.mapControl(node.controlKind)
      : kit.mapTag(node.tag, node.attrs)
  if (mapping) {
    imports?.set(mapping.component, mapping)
    names?.add(mapping.component)
    if (node.controlKind) return
  }
  for (const child of node.children) walkForKit(child, kit, imports, names)
}

function collectContainerMapping(
  node: Extract<IRNode, { kind: 'element' }>,
  kit: UiKitAdapter,
  imports?: Map<string, UiKitMapping>,
  names?: Set<string>
): void {
  // Phase 4 §15.1: a card-like container resolves via `mapContainer` and is
  // collected here, but — unlike a control — it WRAPS its children, so the walk
  // continues into them below (a card's content still renders).
  if (!node.containerKind || !kit.mapContainer) return
  addMapping(kit.mapContainer(node.containerKind), imports, names)
}

function collectDisplayMapping(
  node: Extract<IRNode, { kind: 'element' }>,
  kit: UiKitAdapter,
  imports?: Map<string, UiKitMapping>,
  names?: Set<string>
): void {
  // Phase 4 §22: display primitives (Badge/Alert/etc.) wrap or replace their
  // node but keep walking children, since Badge/Alert still render authored
  // content inside.
  if (!node.displayKind || !kit.mapDisplay) return
  addMapping(kit.mapDisplay(node.displayKind), imports, names)
}

function addMapping(
  mapping: UiKitMapping | null,
  imports?: Map<string, UiKitMapping>,
  names?: Set<string>
): void {
  if (!mapping) return
  imports?.set(mapping.component, mapping)
  names?.add(mapping.component)
}
