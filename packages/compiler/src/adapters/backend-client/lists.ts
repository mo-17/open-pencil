import type { IRBackendResourceQuery, IRTree } from '#compiler/ir/types'

import { emitExpression, type ExprAst } from '@open-pencil/lowcode'

import { scriptExpression, type VueEmitContext } from '../vue/shared'
import { backendQueryFields } from './query-fields'

export function backendQueryInput(
  query: IRBackendResourceQuery,
  after: string | undefined,
  expression: (ast: ExprAst) => string = emitExpression
): string {
  const fields = backendQueryFields(query, expression)
  const currentUser = expression({ kind: 'ident', name: '$currentUser' })
  return `{ resourceId: ${JSON.stringify(query.resourceId)} as const, operation: 'list' as const, sessionGeneration: Number(${currentUser}.generation ?? -1)${query.limit === undefined ? '' : `, limit: ${query.limit}`}${after === undefined ? '' : `, after: String(${after}) || undefined`}${fields.length ? ', ' + fields.join(', ') : ''} }`
}
function targetCallback(target: string | undefined, setter: string): string {
  return target ? `(value) => ${setter}(${JSON.stringify(target)}, value)` : 'undefined'
}
export function emitReactBackendQuery(query: IRBackendResourceQuery): string {
  const input = backendQueryInput(query, query.afterAst && emitExpression(query.afterAst))
  return `  const [${query.rowsName}, set${query.rowsName}] = useState<__opBackend.BackendResourceRows[${JSON.stringify(query.resourceId)}][]>([])
  const [normalize${query.rowsName}] = useState(__opBackend.createBackendQueryState)
  useEffect(() => __opBackend.watchBackendResource(normalize${query.rowsName}(${input}), set${query.rowsName}, ${targetCallback(query.nextCursorTarget, 'setDocState')}, ${targetCallback(query.errorTarget, 'setDocState')}), [${query.deps.join(', ')}])`
}
export function emitVueBackendQuery(
  query: IRBackendResourceQuery,
  context: VueEmitContext
): string {
  const after =
    query.afterAst && scriptExpression(query.afterAst, context.refNames, context.identAliases)
  const input = backendQueryInput(query, after, (ast) =>
    scriptExpression(ast, context.refNames, context.identAliases)
  )
  const rows = context.listAliases.get(query.rowsName) ?? query.rowsName
  return `const ${rows} = __vueRef<__opBackend.BackendResourceRows[${JSON.stringify(query.resourceId)}][]>([])
const normalize${rows} = __opBackend.createBackendQueryState()
__vueWatch(() => (${input}), (input, _previous, onCleanup) => {
  onCleanup(__opBackend.watchBackendResource(normalize${rows}(input), (value) => { ${rows}.value = value }, ${targetCallback(query.nextCursorTarget, '__setDocState')}, ${targetCallback(query.errorTarget, '__setDocState')}))
}, { immediate: true, deep: true })`
}

export function backendClientImport(ir: IRTree, supabasePath: string): string {
  return ir.backendClient
    ? `import * as __opBackend from ${JSON.stringify(supabasePath.replace('_lowcode_supabase', 'lowcode-backend'))}\n`
    : ''
}
export function reactBackendGuard(ir: IRTree, routerAvailable: boolean, guarded: boolean): string {
  if (ir.backendClient && ir.requiresAuth && !routerAvailable)
    return '  if (!$currentUser.ready || !$currentUser.signedIn) return <section>Authentication required.</section>'
  if (!guarded) return ''
  const readiness = ir.backendClient
    ? '  if (!$currentUser.ready) return <section aria-busy="true">Signing in…</section>\n'
    : ''
  return (
    readiness +
    `  if (!$currentUser.signedIn) return <Navigate to=${JSON.stringify(ir.authRedirect ?? '/login')} replace />`
  )
}
export function reactBackendQueryLines(ir: IRTree): string {
  return (ir.backendQueries ?? []).map(emitReactBackendQuery).join('\n')
}

export function emitVueBackendPageRuntime(
  ir: IRTree,
  context: VueEmitContext,
  routerAvailable: boolean,
  currentUser: string | undefined
): string[] {
  const lines = (ir.backendQueries ?? []).map((query) => emitVueBackendQuery(query, context))
  if (ir.requiresAuth && routerAvailable && currentUser && ir.backendClient) {
    lines.push(
      `__vueWatch(() => [${currentUser}.value?.ready, ${currentUser}.value?.signedIn], () => { if (${currentUser}.value?.ready && !${currentUser}.value?.signedIn) void __opRouter.replace(${JSON.stringify(ir.authRedirect ?? '/login')}) }, { immediate: true })`
    )
  }
  return lines
}
