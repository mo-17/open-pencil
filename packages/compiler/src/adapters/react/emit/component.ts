import type { ComponentDef } from '#compiler/ir/types'

import { emitElement } from './element'

/**
 * Phase 3 §8 — build `src/components/<Name>.tsx` for one reusable component.
 *
 * The component takes a single optional `className` prop and applies it to its
 * root `<div>`, so each usage site can position/size the instance in its own
 * context while sharing the body subtree. Empty components still emit a valid
 * (self-closing-ish) wrapper.
 *
 * devMode tags the body elements with `data-node-id` like pages do; the root
 * div is the component's own boundary and intentionally untagged (the usage
 * site's ref carries the instance's sourceId in the page emit).
 */
export function buildComponentModule(def: ComponentDef, devMode: boolean): string {
  // Phase 3 §8 v2: one optional string prop per text-override slot, each
  // defaulting to the master child's text so clean usages (`<Name />`) render
  // unchanged. The body's matching TEXT nodes were collected as `{prop}`.
  const propLines = def.props.map((p) => `\n  ${p.name}?: string`).join('')
  const header = `interface ${def.name}Props {\n  className?: string${propLines}\n}\n\n`
  const destructure = [
    'className',
    ...def.props.map((p) => `${p.name} = ${JSON.stringify(p.defaultValue)}`)
  ].join(', ')
  if (def.children.length === 0) {
    return `${header}export default function ${def.name}({ ${destructure} }: ${def.name}Props) {
  return <div className={className} />
}
`
  }
  const body = def.children.map((c) => emitElement(c, 3, devMode)).join('\n')
  return `${header}export default function ${def.name}({ ${destructure} }: ${def.name}Props) {
  return (
    <div className={className}>
${body}
    </div>
  )
}
`
}

/** Phase 3 §8 — the import lines a page/component needs for the component refs
 *  it contains. `prefix` is the relative path to `src/components/` from the
 *  importing file (`./components/` for App.tsx, `../components/` for page
 *  modules and sibling components). Returns '' when there are no refs. */
export function buildComponentImports(names: readonly string[], prefix: string): string {
  const unique = [...new Set(names)].sort()
  return unique.map((n) => `import ${n} from '${prefix}${n}'`).join('\n')
}
