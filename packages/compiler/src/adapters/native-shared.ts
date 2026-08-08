import type { IRAttrValue, IRElement, IRNode, IRStateDecl, IRTree } from '#compiler/ir/types'
import type { CompileWarning, CompilerOptions } from '#compiler/types'

const NATIVE_BORDER_RADII: Readonly<Partial<Record<string, number>>> = {
  none: 0,
  sm: 2,
  DEFAULT: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  '3xl': 24,
  full: 9999
}

export function createCompileWarningSink(
  warnings: CompileWarning[]
): (warning: CompileWarning) => void {
  const keys = new Set<string>()
  return (warning) => {
    const key = `${warning.code}\0${warning.nodeId ?? ''}\0${warning.message}`
    if (keys.has(key)) return
    keys.add(key)
    warnings.push(warning)
  }
}

export function safeNativeStateDefault(state: IRStateDecl): unknown {
  const value = state.defaultValue
  if (state.type === 'string') return typeof value === 'string' ? value : ''
  if (state.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  if (state.type === 'boolean') return value === true
  if (state.type === 'array') return Array.isArray(value) ? value : []
  return value && typeof value === 'object' ? value : {}
}

export function nativeBorderRadius(token: string): number | undefined {
  return NATIVE_BORDER_RADII[token]
}

export function isNativeSwitch(node: IRElement): boolean {
  if (node.controlKind === 'switch' || node.controlKind === 'checkbox') return true
  if (node.attrs.role === 'switch') return true
  return node.tag === 'input' && node.attrs.type === 'checkbox'
}

export function isNativeTextInput(node: IRElement): boolean {
  return node.tag === 'input' || node.tag === 'textarea'
}

export function staticNativeAttr(value: IRAttrValue | undefined): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && value.kind === 'intlMessage') {
    return value.defaultMessage
  }
  return undefined
}

export function walkNativeNodes(nodes: readonly IRNode[], visit: (node: IRNode) => void): void {
  for (const node of nodes) {
    visit(node)
    if (node.kind === 'element') walkNativeNodes(node.children, visit)
    else if (node.kind === 'conditional') walkNativeNodes([node.consequent], visit)
    else if (node.kind === 'list') walkNativeNodes([node.template], visit)
  }
}

export function selectNativePages(
  irs: readonly IRTree[],
  router: boolean,
  omitted: (ir: IRTree) => void
): readonly IRTree[] {
  if (router || irs.length <= 1) return irs
  for (const ir of irs.slice(1)) omitted(ir)
  return irs.slice(0, 1)
}

export function nativeUnsupportedOptionNames(options: CompilerOptions): string[] {
  const names: string[] = []
  if (options.uiKit) names.push('uiKit')
  if (options.metadata) names.push('metadata')
  if (options.themeCss?.trim()) names.push('themeCss')
  if (options.themeSwitch) names.push('themeSwitch')
  if (options.i18n) names.push('i18n runtime')
  return names
}
