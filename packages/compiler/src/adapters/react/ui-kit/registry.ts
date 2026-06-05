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
export function collectKitImports(
  nodes: readonly IRNode[],
  kit: UiKitAdapter
): UiKitMapping[] {
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
  const mapping = kit.mapTag(node.tag, node.attrs)
  if (mapping) {
    imports?.set(mapping.component, mapping)
    names?.add(mapping.component)
  }
  for (const child of node.children) walkForKit(child, kit, imports, names)
}
