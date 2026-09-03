import {
  buildLegacySupabaseClientRuntime,
  buildLegacySupabaseEnvironmentExample,
  buildLegacySupabaseViteEnvironmentTypes,
  SUPABASE_JS_VERSION
} from '#compiler/backend/supabase/legacy-react-artifacts'
import type { IRListOrder, IRListQuery, IRSupabaseFilter } from '#compiler/ir/types'

import { scriptExpression, scriptJSON, type VueEmitContext } from '../shared'

export { SUPABASE_JS_VERSION }

const LEGACY_STATE_IMPORT = "from './_lowcode_state'"
const VUE_STATE_IMPORT = "from './lowcode-state'"

/**
 * Reuse the reviewed provider-owned client byte builder and adapt only the
 * framework-neutral document-state module path used by Vue projects. Keeping
 * this as one exact, asserted rewrite makes provider drift fail loudly.
 */
export function buildVueSupabaseClientRuntime(
  config: Parameters<typeof buildLegacySupabaseClientRuntime>[0]
): string {
  const source = buildLegacySupabaseClientRuntime(config)
  if (!source.includes(LEGACY_STATE_IMPORT)) {
    throw new Error('Supabase client runtime state import contract changed')
  }
  return source.replace(LEGACY_STATE_IMPORT, VUE_STATE_IMPORT)
}

export const buildVueSupabaseEnvironmentExample = buildLegacySupabaseEnvironmentExample
export const buildVueSupabaseViteEnvironmentTypes = buildLegacySupabaseViteEnvironmentTypes

export function emitVueSupabaseFilterChain(
  filters: readonly IRSupabaseFilter[],
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string> = context.identAliases
): string {
  return filters
    .map((filter) => {
      const value = scriptExpression(filter.ast, context.refNames, aliases)
      return `.${filter.op}(${scriptJSON(filter.column)}, (${value}) as never)`
    })
    .join('')
}

function emitOrderClause(order: IRListOrder, context: VueEmitContext): string {
  const column = order.columnAst
    ? scriptExpression(order.columnAst, context.refNames, context.identAliases)
    : scriptJSON(order.column)
  const ascending = order.ascendingAst
    ? scriptExpression(order.ascendingAst, context.refNames, context.identAliases)
    : String(order.ascending)
  return `.order(${column}, { ascending: ${ascending} })`
}

function emitPaging(query: IRListQuery, context: VueEmitContext): string {
  if (query.limit === undefined) return ''
  if (!query.offsetAst) return `.limit(${query.limit})`
  const offset = scriptExpression(query.offsetAst, context.refNames, context.identAliases)
  return `.range(${offset}, ${offset} + ${query.limit} - 1)`
}

function dependencyExpression(value: string, context: VueEmitContext): string {
  const stringified = /^JSON\.stringify\(([A-Za-z_$][A-Za-z0-9_$]*)\)$/.exec(value)
  const raw = stringified?.[1] ?? value
  const alias = context.identAliases.get(raw) ?? raw
  const expression = context.refNames.has(alias) ? `${alias}.value` : alias
  return stringified ? `JSON.stringify(${expression})` : expression
}

/**
 * Emit a race-safe Vue watcher for a data-bound list. Vue automatically stops
 * the watcher with the component scope; a monotonically increasing generation
 * prevents an older response from replacing newer filter/sort results.
 */
export function emitVueListQueryRuntime(
  query: IRListQuery,
  context: VueEmitContext,
  requiresAuth = false
): string {
  context.expressionIndex += 1
  const generation = `__opListGeneration_${context.expressionIndex}`
  const rows = context.listAliases.get(query.rowsName) ?? query.rowsName
  const chain =
    `__opGetSupabaseClient().from(${scriptJSON(query.table)})` +
    `.select(${scriptJSON(query.columns)})` +
    emitVueSupabaseFilterChain(query.filters, context) +
    query.orderBy.map((order) => emitOrderClause(order, context)).join('') +
    emitPaging(query, context)
  const dependencies = query.deps.map((dependency) => dependencyExpression(dependency, context))
  const currentUser = context.identAliases.get('$currentUser')
  const authGuard =
    requiresAuth && currentUser
      ? `    if (!${currentUser}.value?.signedIn) {
      ${rows}.value = []
      return
    }
`
      : ''
  return `let ${generation} = 0
__vueWatch(
  () => [${dependencies.join(', ')}],
  async () => {
${authGuard}    const __opGeneration = ++${generation}
    const { data: __opData, error: __opError } = await ${chain}
    if (__opGeneration !== ${generation}) return
    if (__opError) {
      console.error('Supabase list request failed:', __opError)
      return
    }
    ${rows}.value = Array.isArray(__opData) ? __opData : []
  },
  { immediate: true, deep: true }
)`
}
