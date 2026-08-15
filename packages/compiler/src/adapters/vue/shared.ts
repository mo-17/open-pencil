import type { IRTree } from '#compiler/ir/types'
import type { CompileWarning } from '#compiler/types'

import { emitExpression } from '@open-pencil/lowcode'
import type { ExprAst } from '@open-pencil/lowcode'

export const SAFE_HREF_RUNTIME = `function __safeHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const href = value.trim()
  if (!href || /[\\u0000-\\u001f\\u007f\\\\]/.test(href) || href.startsWith('//')) return undefined
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(href)?.[0].toLowerCase()
  if (scheme) return ['http:', 'https:', 'mailto:', 'tel:'].includes(scheme) ? href : undefined
  return href.startsWith('/') || href.startsWith('#') || href.startsWith('?') ? href : undefined
}`

export const CURRENT_USER_FALLBACK =
  'const $currentUser = Object.freeze({ id: null, email: null, signedIn: false })'

export interface VueEmitContext {
  devMode: boolean
  routerAvailable: boolean
  refNames: Set<string>
  writableStateNames: ReadonlyMap<string, string>
  identAliases: ReadonlyMap<string, string>
  listAliases: ReadonlyMap<string, string>
  docStateTypes: ReadonlyMap<string, IRTree['docStates'][number]['type']>
  componentAliases: ReadonlyMap<string, string>
  assetImports: Map<string, string>
  validationKeyBindings: Map<string, string>
  templateBindings: string[]
  eventFunctions: string[]
  warnings: CompileWarning[]
  expressionIndex: number
  eventIndex: number
  safeHrefRequired: boolean
}

export interface VueLocalBinding {
  name: string
  alias: string
}

export function createContext(
  devMode: boolean,
  routerAvailable: boolean,
  refNames: Set<string>,
  states: readonly IRTree['states'][number][],
  identAliases: ReadonlyMap<string, string> = new Map(),
  listAliases: ReadonlyMap<string, string> = new Map(),
  docStateTypes: ReadonlyMap<string, IRTree['docStates'][number]['type']> = new Map(),
  componentAliases: ReadonlyMap<string, string> = new Map()
): VueEmitContext {
  return {
    devMode,
    routerAvailable,
    refNames,
    writableStateNames: new Map(
      states
        .filter((state) => !state.computed)
        .map((state) => [state.name, identAliases.get(state.name) ?? state.name])
    ),
    identAliases,
    listAliases,
    docStateTypes,
    componentAliases,
    assetImports: new Map(),
    validationKeyBindings: new Map(),
    templateBindings: [],
    eventFunctions: [],
    warnings: [],
    expressionIndex: 0,
    eventIndex: 0,
    safeHrefRequired: false
  }
}

export function templateExpression(
  ast: ExprAst,
  aliases: ReadonlyMap<string, string>,
  locals: readonly VueLocalBinding[]
): string {
  return emitExpression(mapIdentifiers(ast, withLocalAliases(aliases, locals), new Set()))
}

export function scriptExpression(
  ast: ExprAst,
  refs: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>
): string {
  return safeScript(emitExpression(mapIdentifiers(ast, aliases, refs)))
}

function mapIdentifiers(
  ast: ExprAst,
  aliases: ReadonlyMap<string, string>,
  refs: ReadonlySet<string>
): ExprAst {
  switch (ast.kind) {
    case 'ident': {
      const name = aliases.get(ast.name) ?? ast.name
      return refs.has(name)
        ? { kind: 'member', object: { kind: 'ident', name }, property: 'value' }
        : { ...ast, name }
    }
    case 'member':
      if (unsupportedCurrentUserMember(ast)) return { kind: 'ident', name: 'undefined' }
      return { ...ast, object: mapIdentifiers(ast.object, aliases, refs) }
    case 'unary':
      return { ...ast, arg: mapIdentifiers(ast.arg, aliases, refs) }
    case 'binary':
      return {
        ...ast,
        left: mapIdentifiers(ast.left, aliases, refs),
        right: mapIdentifiers(ast.right, aliases, refs)
      }
    case 'ternary':
      return {
        ...ast,
        test: mapIdentifiers(ast.test, aliases, refs),
        consequent: mapIdentifiers(ast.consequent, aliases, refs),
        alternate: mapIdentifiers(ast.alternate, aliases, refs)
      }
    case 'template':
      return {
        ...ast,
        expressions: ast.expressions.map((item) => mapIdentifiers(item, aliases, refs))
      }
    default:
      return ast
  }
}

function unsupportedCurrentUserMember(ast: Extract<ExprAst, { kind: 'member' }>): boolean {
  let root: ExprAst = ast.object
  let depth = 1
  while (root.kind === 'member') {
    root = root.object
    depth += 1
  }
  if (root.kind !== 'ident' || root.name !== '$currentUser') return false
  return depth > 1 || !['id', 'email', 'signedIn'].includes(ast.property)
}

export function componentPropAlias(value: string): string {
  return generatedAlias('Prop', value)
}

export function componentRuntimeAlias(value: string): string {
  const stem = value.replace(/[^A-Za-z0-9]/g, '').slice(0, 32) || 'Component'
  return `OpenPencil${stem}${stableHash(value)}`
}

export function identifierShadowWarning(
  name: string,
  shadowedKind: string,
  activeKind: string
): CompileWarning {
  return {
    code: 'vue-identifier-shadowed',
    message: `Vue v1 ignored ${shadowedKind} '${name}' because it collides with an in-scope ${activeKind}.`
  }
}

export function currentUserBindingWarning(): CompileWarning {
  return {
    code: 'vue-current-user-binding-unsupported',
    message:
      'Vue v1 does not provide Supabase authentication; $currentUser reads use a signed-out fallback.'
  }
}

export function generatedAlias(kind: string, value: string): string {
  const stem = value.replace(/[^A-Za-z0-9_$]/g, '_').slice(0, 32) || 'value'
  return `__op${kind}_${stem}_${stableHash(value)}`
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function createLocalBinding(name: string, index: number): VueLocalBinding {
  return { name, alias: generatedAlias('Local', `${index}_${name}`) }
}

export function withLocalAliases(
  aliases: ReadonlyMap<string, string>,
  locals: readonly VueLocalBinding[]
): ReadonlyMap<string, string> {
  if (locals.length === 0) return aliases
  const result = new Map(aliases)
  for (const local of locals) result.set(local.name, local.alias)
  return result
}

export function scopedIdentifier(
  value: string,
  aliases: ReadonlyMap<string, string>,
  locals: readonly VueLocalBinding[]
): string {
  for (let index = locals.length - 1; index >= 0; index--) {
    if (locals[index].name === value) return locals[index].alias
  }
  return aliases.get(value) ?? value
}

export function sanitizeVueHrefLiteral(value: string): string | undefined {
  const href = value.trim()
  if (!href || hasUnsafeHrefCharacter(href) || href.startsWith('//')) return undefined
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(href)?.[0].toLowerCase()
  if (scheme) return ['http:', 'https:', 'mailto:', 'tel:'].includes(scheme) ? href : undefined
  return href.startsWith('/') || href.startsWith('#') || href.startsWith('?') ? href : undefined
}

export function sanitizeVueRouteTarget(value: string): string | undefined {
  const route = value.trim()
  if (!route || hasUnsafeHrefCharacter(route) || route.startsWith('//')) return undefined
  return route.startsWith('/') || route.startsWith('#') || route.startsWith('?') ? route : undefined
}

function hasUnsafeHrefCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f || character === '\\') return true
  }
  return false
}

export function vueAssetURL(value: string): string {
  if (value.startsWith('./assets/')) return `../assets/${value.slice('./assets/'.length)}`
  if (value.startsWith('src/assets/')) return `../assets/${value.slice('src/assets/'.length)}`
  return value
}

export function attrName(value: string): string | null {
  const mapped: Record<string, string> = {
    className: 'class',
    defaultValue: 'value',
    defaultChecked: 'checked',
    htmlFor: 'for',
    readOnly: 'readonly',
    tabIndex: 'tabindex'
  }
  const name = mapped[value] ?? value
  if (/^on/i.test(name) || /^v-/i.test(name) || /^[:@#]/.test(name)) return null
  return /^[A-Za-z_:][A-Za-z0-9:._-]*$/.test(name) ? name : null
}

export function scriptJSON(value: unknown): string {
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    return 'null'
  }
  return safeScript(JSON.stringify(value))
}

export function safeScript(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script')
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function escapeStaticText(value: string): string {
  return escapeText(value).replaceAll('{', '&#123;').replaceAll('}', '&#125;')
}

export function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function docStateTypeScript(type: IRTree['docStates'][number]['type'] | undefined): string {
  if (type === 'string' || type === 'number' || type === 'boolean') return type
  if (type === 'array') return 'unknown[]'
  if (type === 'object') return 'Record<string, unknown>'
  return 'unknown'
}
