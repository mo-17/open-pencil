import type { ComponentDef, VariantCase } from '#compiler/ir/types'

import { emitElement } from './element'
import { hasIntlAttr, hasTranslatableText } from '../ir-walk'
import { buildReactIntlImport } from '../lowcode/i18n'

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
  // Phase 3 §9: a component body with i18n-tagged visible text needs
  // FormattedMessage; §9 v3: a translated attribute (placeholder) needs useIntl.
  const usesIntl = componentHasIntlAttr(def)
  const i18nImport = buildReactIntlImport({
    formattedMessage: componentHasTranslatableText(def),
    intl: usesIntl
  })
  const importBlock = i18nImport ? `${i18nImport}\n` : ''
  return importBlock + buildComponentBody(def, devMode, usesIntl)
}

/** True when any node in the component's body (plain children or any variant
 *  subtree) carries an i18n message — drives the FormattedMessage import. */
function componentHasTranslatableText(def: ComponentDef): boolean {
  if (hasTranslatableText(def.children)) return true
  return (def.variants ?? []).some((v) => hasTranslatableText(v.children))
}

/** Phase 3 §9 v3 — true when any node in the component's body carries an
 *  i18n-externalized attribute → the body gets a `const intl = useIntl()` hook. */
function componentHasIntlAttr(def: ComponentDef): boolean {
  if (hasIntlAttr(def.children)) return true
  return (def.variants ?? []).some((v) => hasIntlAttr(v.children))
}

function buildComponentBody(def: ComponentDef, devMode: boolean, usesIntl: boolean): string {
  // Phase 3 §9 v3: the `const intl = useIntl()` hook line (empty when the body
  // has no translated attribute → byte-identical to the pre-§9-v3 output).
  const intlHook = usesIntl ? '  const intl = useIntl()\n' : ''
  // Phase 3 §8 v4: a COMPONENT_SET emits per-axis variant props + a subtree
  // switch instead of the single shared body.
  if (def.variantAxes && def.variants) return buildVariantModule(def, devMode, intlHook)
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
${intlHook}  return <div className={className} />
}
`
  }
  const body = def.children.map((c) => emitElement(c, 3, devMode)).join('\n')
  return `${header}export default function ${def.name}({ ${destructure} }: ${def.name}Props) {
${intlHook}  return (
    <div className={className}>
${body}
    </div>
  )
}
`
}

/**
 * Phase 3 §8 v4 — a COMPONENT_SET: one optional string-union prop per variant
 * axis (defaulting to the default variant's value), then a switch on the joined
 * axis key returning each variant's subtree. The default variant (the first) is
 * the unconditional fallback so un-passed / unknown combinations still render.
 */
function buildVariantModule(def: ComponentDef, devMode: boolean, intlHook: string): string {
  const axes = def.variantAxes ?? []
  const variants = def.variants ?? []
  // Phase 3 §8 v5: one string-union prop per variant axis, plus (composed from
  // v2/v3) one optional text/className prop per name-merged override slot. The
  // text/className props get NO destructure default — each variant subtree
  // falls back to its own literal via `{prop ?? ownLiteral}`.
  const axisLines = axes
    .map((a) => `\n  ${a.name}?: ${a.options.map((o) => JSON.stringify(o)).join(' | ')}`)
    .join('')
  const propLines = axisLines + def.props.map((p) => `\n  ${p.name}?: string`).join('')
  const header = `interface ${def.name}Props {\n  className?: string${propLines}\n}\n\n`
  const destructure = [
    'className',
    ...axes.map((a) => `${a.name} = ${JSON.stringify(a.defaultValue)}`),
    ...def.props.map((p) => p.name)
  ].join(', ')
  // A registered SET always has ≥1 variant, but guard so the slice below is
  // sound and the fallback never references an undefined case.
  if (variants.length === 0) {
    return `${header}export default function ${def.name}({ className }: ${def.name}Props) {
  return <div className={className} />
}
`
  }
  const key = '`' + axes.map((a) => `\${${a.name}}`).join('|') + '`'
  const [defaultCase, ...rest] = variants
  const guards = rest
    .map(
      (v) => `  if (__variant === ${JSON.stringify(v.key)}) {
    return ${variantBody(v, devMode)}
  }
`
    )
    .join('')
  return `${header}export default function ${def.name}({ ${destructure} }: ${def.name}Props) {
${intlHook}  const __variant = ${key}
${guards}  return ${variantBody(defaultCase, devMode)}
}
`
}

/** Render one variant's `<div className={className}>…</div>` return value. */
function variantBody(variant: VariantCase, devMode: boolean): string {
  if (variant.children.length === 0) return '<div className={className} />'
  const body = variant.children.map((c) => emitElement(c, 3, devMode)).join('\n')
  return `(
    <div className={className}>
${body}
    </div>
  )`
}

/** Phase 3 §8 — the import lines a page/component needs for the component refs
 *  it contains. `prefix` is the relative path to `src/components/` from the
 *  importing file (`./components/` for App.tsx, `../components/` for page
 *  modules and sibling components). Returns '' when there are no refs. */
export function buildComponentImports(names: readonly string[], prefix: string): string {
  const unique = [...new Set(names)].sort()
  return unique.map((n) => `import ${n} from '${prefix}${n}'`).join('\n')
}
