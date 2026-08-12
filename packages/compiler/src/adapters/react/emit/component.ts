import type { ComponentDef, ComponentProp, IRNode, VariantCase } from '#compiler/ir/types'

import {
  hasIntlAttr,
  hasTranslatableText,
  nodesUseServerWorkflow,
  nodesHaveNavigateHandler,
  nodesHaveNavigateParams,
  referencedLucideIconNames
} from '../ir-walk'
import { buildReactIntlImport } from '../lowcode/i18n'
import {
  buildValidationGlue,
  validationUsesDocStateSnapshot,
  validationUsesRemote
} from '../lowcode/validation'
import { buildReactModuleImports } from '../modules/registry'
import { collectKitImports, kitImportLine } from '../ui-kit/registry'
import type { UIKitAdapter } from '../ui-kit/types'
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
export function buildComponentModule(
  def: ComponentDef,
  devMode: boolean,
  uiKit: UIKitAdapter | null = null,
  motionBoundary = false,
  rootEventsBoundary = false,
  motionScopeBoundary = false,
  prototypeBoundary = false,
  routerAvailable = false
): string {
  const bodyNodes = componentBodyNodes(def)
  const needsNavigate = routerAvailable && nodesHaveNavigateHandler(bodyNodes)
  // Phase 3 §9: a component body with i18n-tagged visible text needs
  // FormattedMessage; §9 v3: a translated attribute (placeholder) needs useIntl.
  const usesIntl = componentHasIntlAttr(def)
  const i18nImport = buildReactIntlImport({
    formattedMessage: componentHasTranslatableText(def),
    intl: usesIntl
  })
  // Phase 3 §15: a component body can render interactive nodes too, so it needs
  // its own kit imports.
  const kitImports = uiKit ? collectKitImports(bodyNodes, uiKit) : []
  const kitImportBlock =
    kitImports.length > 0 ? kitImports.map(kitImportLine).join('\n') + '\n' : ''
  const lucideImport = buildLucideIconImport(referencedLucideIconNames(bodyNodes))
  const moduleImports = buildReactModuleImports(bodyNodes, true)
  const moduleImportBlock = moduleImports ? `${moduleImports}\n` : ''
  const serverImport = nodesUseServerWorkflow(bodyNodes)
    ? `import { invokeServerWorkflow } from '../_lowcode_server'\n`
    : ''
  const reactImport = buildComponentReactImport(def, rootEventsBoundary)
  const routerImport = buildComponentRouterImport(needsNavigate, nodesHaveNavigateParams(bodyNodes))
  const lowcodeStateImport = buildComponentLowcodeStateImport(def)
  const validationImport = buildComponentValidationImport(def)
  const imports = [
    reactImport,
    routerImport,
    lowcodeStateImport,
    validationImport,
    i18nImport,
    kitImportBlock,
    lucideImport,
    moduleImportBlock,
    serverImport
  ].join('')
  const importBlock = imports ? `${imports}\n` : ''
  return (
    importBlock +
    buildComponentBody(
      def,
      devMode,
      usesIntl,
      uiKit,
      motionBoundary,
      rootEventsBoundary,
      motionScopeBoundary,
      prototypeBoundary,
      needsNavigate
    )
  )
}

/** All body nodes of a component def (plain children + every variant subtree).
 *  Mirrors index.ts `componentBodyNodes`; kept local to avoid a cross-import. */
function componentBodyNodes(def: ComponentDef): readonly IRNode[] {
  return def.variants ? [...def.children, ...def.variants.flatMap((v) => v.children)] : def.children
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

function buildComponentBody(
  def: ComponentDef,
  devMode: boolean,
  usesIntl: boolean,
  uiKit: UIKitAdapter | null,
  motionBoundary: boolean,
  rootEventsBoundary: boolean,
  motionScopeBoundary: boolean,
  prototypeBoundary: boolean,
  needsNavigate: boolean
): string {
  // Phase 3 §9 v3: the `const intl = useIntl()` hook line (empty when the body
  // has no translated attribute → byte-identical to the pre-§9-v3 output).
  const hookBlock = buildComponentHookBlock(def, usesIntl, needsNavigate)
  // Phase 3 §8 v4: a COMPONENT_SET emits per-axis variant props + a subtree
  // switch instead of the single shared body.
  if (def.variantAxes && def.variants) {
    return buildVariantModule(
      def,
      devMode,
      hookBlock,
      uiKit,
      motionBoundary,
      rootEventsBoundary,
      motionScopeBoundary,
      prototypeBoundary
    )
  }
  // Phase 3 §8 v2: one optional string prop per text-override slot, each
  // defaulting to the master child's text so clean usages (`<Name />`) render
  // unchanged. The body's matching TEXT nodes were collected as `{prop}`.
  const propLines = def.props.map(componentPropLine).join('')
  const { header, destructure } = componentFunctionParts(
    def,
    propLines,
    motionBoundary,
    rootEventsBoundary,
    prototypeBoundary,
    def.props.map((p) =>
      p.kind === 'style' ? p.name : `${p.name} = ${JSON.stringify(p.defaultValue)}`
    )
  )
  const rootAttrs = componentRootAttrs(
    motionBoundary,
    rootEventsBoundary,
    motionScopeBoundary,
    prototypeBoundary
  )
  if (def.children.length === 0) {
    return `${header}export default function ${def.name}({ ${destructure} }: ${def.name}Props) {
${hookBlock}  return <div${rootAttrs} className={className} style={style} />
}
`
  }
  const body = def.children.map((c) => emitElement(c, 3, devMode, uiKit)).join('\n')
  return `${header}export default function ${def.name}({ ${destructure} }: ${def.name}Props) {
${hookBlock}  return (
    <div${rootAttrs} className={className} style={style}>
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
function buildVariantModule(
  def: ComponentDef,
  devMode: boolean,
  hookBlock: string,
  uiKit: UIKitAdapter | null,
  motionBoundary: boolean,
  rootEventsBoundary: boolean,
  motionScopeBoundary: boolean,
  prototypeBoundary: boolean
): string {
  const axes = def.variantAxes ?? []
  const variants = def.variants ?? []
  // Phase 3 §8 v5: one string-union prop per variant axis, plus (composed from
  // v2/v3) one optional text/className prop per name-merged override slot. The
  // text/className props get NO destructure default — each variant subtree
  // falls back to its own literal via `{prop ?? ownLiteral}`.
  const axisLines = axes
    .map((a) => `\n  ${a.name}?: ${a.options.map((o) => JSON.stringify(o)).join(' | ')}`)
    .join('')
  const propLines = axisLines + def.props.map(componentPropLine).join('')
  const { header, destructure } = componentFunctionParts(
    def,
    propLines,
    motionBoundary,
    rootEventsBoundary,
    prototypeBoundary,
    [
      ...axes.map((a) => `${a.name} = ${JSON.stringify(a.defaultValue)}`),
      ...def.props.map((p) => p.name)
    ]
  )
  const rootAttrs = componentRootAttrs(
    motionBoundary,
    rootEventsBoundary,
    motionScopeBoundary,
    prototypeBoundary
  )
  // A registered SET always has ≥1 variant, but guard so the slice below is
  // sound and the fallback never references an undefined case.
  if (variants.length === 0) {
    const emptyDestructure = componentDestructure(
      def,
      motionBoundary,
      rootEventsBoundary,
      prototypeBoundary
    )
    return `${header}export default function ${def.name}({ ${emptyDestructure} }: ${def.name}Props) {
  return <div${rootAttrs} className={className} style={style} />
}
`
  }
  const key = '`' + axes.map((a) => `\${${a.name}}`).join('|') + '`'
  const [defaultCase, ...rest] = variants
  const guards = rest
    .map(
      (v) => `  if (__variant === ${JSON.stringify(v.key)}) {
    return ${variantBody(v, devMode, uiKit, motionBoundary, rootEventsBoundary, motionScopeBoundary, prototypeBoundary)}
  }
`
    )
    .join('')
  return `${header}export default function ${def.name}({ ${destructure} }: ${def.name}Props) {
${hookBlock}  const __variant = ${key}
${guards}  return ${variantBody(defaultCase, devMode, uiKit, motionBoundary, rootEventsBoundary, motionScopeBoundary, prototypeBoundary)}
}
`
}

function componentFunctionParts(
  def: ComponentDef,
  propLines: string,
  motionBoundary: boolean,
  rootEventsBoundary: boolean,
  prototypeBoundary: boolean,
  destructuredProps: readonly string[]
): { header: string; destructure: string } {
  return {
    header: componentPropsHeader(
      def.name,
      propLines,
      motionBoundary,
      rootEventsBoundary,
      prototypeBoundary,
      def.prototypeBody === true
    ),
    destructure: componentDestructure(
      def,
      motionBoundary,
      rootEventsBoundary,
      prototypeBoundary,
      destructuredProps
    )
  }
}

function componentDestructure(
  def: ComponentDef,
  motionBoundary: boolean,
  rootEventsBoundary: boolean,
  prototypeBoundary: boolean,
  destructuredProps: readonly string[] = []
): string {
  return [
    'className',
    'style',
    ...(def.prototypeBody ? ['__opPrototypeScope'] : []),
    ...(rootEventsBoundary ? ['__opRootEvents'] : []),
    ...(motionBoundary ? ['__opMotionKey', '__opMotionDriversKey', '__opNodeId'] : []),
    ...(prototypeBoundary ? prototypeDestructureNames() : []),
    ...destructuredProps
  ].join(', ')
}

function componentPropsHeader(
  name: string,
  propLines: string,
  motionBoundary: boolean,
  rootEventsBoundary: boolean,
  prototypeBoundary: boolean,
  prototypeBody = false
): string {
  const rootEventsProp = rootEventsBoundary
    ? "\n  __opRootEvents?: Pick<HTMLAttributes<HTMLDivElement>, 'onClick' | 'onChange' | 'onSubmit' | 'onFocus' | 'onBlur'>"
    : ''
  const motionProp = motionBoundary
    ? '\n  __opMotionKey?: string\n  __opMotionDriversKey?: string\n  __opNodeId?: string'
    : ''
  const prototypeProps = prototypeBoundary
    ? '\n  __opPrototypeNode?: string\n  __opPrototypeSource?: boolean\n  __opPrototypeKeyboard?: boolean\n  __opTransitionKey?: string\n  __opPrototypeOverlayTarget?: boolean'
    : ''
  const prototypeScopeProp = prototypeBody ? '\n  __opPrototypeScope: string' : ''
  return `interface ${name}Props {\n  className?: string\n  style?: CSSProperties${rootEventsProp}${motionProp}${prototypeProps}${prototypeScopeProp}${propLines}\n}\n\n`
}

function componentRootAttrs(
  motionBoundary: boolean,
  rootEventsBoundary: boolean,
  motionScopeBoundary: boolean,
  prototypeBoundary: boolean
): string {
  const events = rootEventsBoundary ? ' {...__opRootEvents}' : ''
  const motion = motionBoundary
    ? ' data-node-id={__opNodeId} data-op-motion={__opMotionKey} data-op-motion-drivers={__opMotionDriversKey}'
    : ''
  const scope = motionScopeBoundary ? ' data-op-motion-scope' : ''
  const prototype = prototypeBoundary
    ? " data-op-prototype-node={__opPrototypeNode} data-op-prototype-source={__opPrototypeSource ? '' : undefined} data-op-prototype-keyboard={__opPrototypeKeyboard ? '' : undefined} role={__opPrototypeKeyboard ? 'button' : undefined} tabIndex={__opPrototypeKeyboard ? 0 : undefined} data-op-transition-key={__opTransitionKey} data-op-prototype-overlay-target={__opPrototypeOverlayTarget ? '' : undefined} hidden={__opPrototypeOverlayTarget || undefined}"
    : ''
  return `${events}${motion}${scope}${prototype}`
}

function prototypeDestructureNames(): string[] {
  return [
    '__opPrototypeNode',
    '__opPrototypeSource',
    '__opPrototypeKeyboard',
    '__opTransitionKey',
    '__opPrototypeOverlayTarget'
  ]
}

function componentPropLine(prop: ComponentProp): string {
  const type = prop.kind === 'style' ? 'CSSProperties' : 'string'
  return `\n  ${prop.name}?: ${type}`
}

function buildComponentReactImport(def: ComponentDef, rootEventsBoundary: boolean): string {
  const names: string[] = []
  if ((def.validatedFields?.length ?? 0) > 0) names.push('useState')
  if (validationUsesRemote(def.validatedFields ?? [])) names.push('useRef')
  const valueImport = names.length > 0 ? `import { ${names.join(', ')} } from 'react'\n` : ''
  const typeNames = ['CSSProperties', ...(rootEventsBoundary ? ['HTMLAttributes'] : [])]
  return `${valueImport}import type { ${typeNames.join(', ')} } from 'react'\n`
}

function buildComponentRouterImport(needsNavigate: boolean, hasNavigateParams: boolean): string {
  if (!needsNavigate) return ''
  const names = ['useNavigate', ...(hasNavigateParams ? ['generatePath'] : [])]
  return `import { ${names.join(', ')} } from 'react-router-dom'\n`
}

function buildComponentLowcodeStateImport(def: ComponentDef): string {
  const names: string[] = []
  if ((def.docStateReads?.length ?? 0) > 0) names.push('useDocState')
  if ((def.docStateWrites?.length ?? 0) > 0) names.push('setDocState')
  if (validationUsesDocStateSnapshot(def.validatedFields ?? [])) names.push('getDocStateSnapshot')
  if (names.length === 0) return ''
  return `import { ${[...new Set(names)].join(', ')} } from '../_lowcode_state'\n`
}

function buildComponentValidationImport(def: ComponentDef): string {
  if ((def.validatedFields?.length ?? 0) === 0) return ''
  const names = ['validateValue']
  if (validationUsesRemote(def.validatedFields ?? [])) names.push('validateRemote')
  return `import { ${names.sort().join(', ')} } from '../_lowcode_validation'\n`
}

function buildComponentHookBlock(
  def: ComponentDef,
  usesIntl: boolean,
  needsNavigate: boolean
): string {
  const lines = [
    needsNavigate ? '  const navigate = useNavigate()' : '',
    ...(def.docStateReads ?? []).map(
      (name) => `  const ${name} = useDocState(${JSON.stringify(name)})`
    ),
    (def.validatedFields?.length ?? 0) > 0 ? buildValidationGlue(def.validatedFields ?? []) : '',
    usesIntl ? '  const intl = useIntl()' : ''
  ].filter((line) => line !== '')
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

/** Render one variant's `<div className={className}>…</div>` return value. */
function variantBody(
  variant: VariantCase,
  devMode: boolean,
  uiKit: UIKitAdapter | null,
  motionBoundary: boolean,
  rootEventsBoundary: boolean,
  motionScopeBoundary: boolean,
  prototypeBoundary: boolean
): string {
  const rootAttrs = componentRootAttrs(
    motionBoundary,
    rootEventsBoundary,
    motionScopeBoundary,
    prototypeBoundary
  )
  if (variant.children.length === 0) {
    return `<div${rootAttrs} className={className} style={style} />`
  }
  const body = variant.children.map((c) => emitElement(c, 3, devMode, uiKit)).join('\n')
  return `(
    <div${rootAttrs} className={className} style={style}>
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

/** Phase 4 §23 — one named import line for every lucide-react icon a module
 *  renders. Names are already validated + normalized by IR collect. */
export function buildLucideIconImport(names: readonly string[]): string {
  if (names.length === 0) return ''
  return `import { ${names.join(', ')} } from 'lucide-react'\n`
}
