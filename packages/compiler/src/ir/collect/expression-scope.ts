import type { IRDocStateDecl, IRStateDecl } from '../types'
const EMPTY_DOCSTATES: ReadonlyMap<string, IRDocStateDecl> = new Map()
/** Phase 4 §16.1: the route-params built-in. An expression may read
 *  `$params.<name>` anywhere a docState read is allowed; the member name is not
 *  validated (mirrors `$currentUser.email`), since `useParams()` returns
 *  `string | undefined` per key at runtime. `$` is a reserved name prefix
 *  (`validateStateName` rejects it) so it can't collide with a user state /
 *  docState. */
export const ROUTE_PARAMS_IDENT = '$params'

/** Phase 4 §16.4: the query-string built-in (`$query.foo`). `$`-prefixed
 *  (`validateStateName` rejects it) so it can't collide with a user state /
 *  docState. Resolved at emit to `Object.fromEntries(useSearchParams()[0])`. */
export const QUERY_PARAMS_IDENT = '$query'

/** Identifiers accepted by `unknownIdentifiers` without being a state / docState
 *  / in-scope name — the route-params (§16.1) + query-string (§16.4) built-ins,
 *  both read-only and resolved to react-router hooks at emit. */
const BUILTIN_READ_IDENTS: ReadonlySet<string> = new Set([ROUTE_PARAMS_IDENT, QUERY_PARAMS_IDENT])

/** Identifiers referenced by an expression that match neither a declared
 *  page state, an in-scope identifier, nor a Document State. Used by
 *  `resolveTextBinding` (kind=expr), the renderCondition resolver in
 *  `tree.ts`, and the apiCall URL-template resolver.
 *
 *  Phase 2 §4: `docStates` widens the allow-set so a read-context expression
 *  may reference a Document State name (decision §4.2 #3). Callers that
 *  accept the reference must also call `registerDocStateReads` so the page
 *  emits the matching `useDocState` local. */
export function unknownIdentifiers(
  references: ReadonlySet<string>,
  states: Map<string, IRStateDecl>,
  inScope: ReadonlySet<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl> = EMPTY_DOCSTATES
): string[] {
  const stateNames = new Set<string>()
  for (const s of states.values()) stateNames.add(s.name)
  const out: string[] = []
  for (const ref of references) {
    if (stateNames.has(ref)) continue
    if (inScope.has(ref)) continue
    if (docStates.has(ref)) continue
    // Phase 4 §16.1: route-params (`$params`) built-in — allowed everywhere a
    // read-context expression is, resolved at emit to `useParams()`.
    if (BUILTIN_READ_IDENTS.has(ref)) continue
    out.push(ref)
  }
  return out
}

/** Phase 2 §4: record every reference that resolves to a Document State into
 *  `docStateReads`, so the page component emits a `const x = useDocState('x')`
 *  local for it. A no-op when `docStateReads` is undefined.
 *
 *  Phase 4 §16.1 / §16.4: this is also the single chokepoint where every
 *  accepted expression's references flow through, so the read-only built-ins
 *  (`$params`, `$query`) ride the same set. `collectTree` extracts them out into
 *  the `usesRouteParams` / `usesQueryParams` flags afterwards, keeping
 *  `docStateReads` itself pure doc-states for the emit consumers. */
export function registerDocStateReads(
  references: Iterable<string>,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string> | undefined
): void {
  if (!docStateReads) return
  for (const ref of references) {
    if (docStates.has(ref) || BUILTIN_READ_IDENTS.has(ref)) docStateReads.add(ref)
  }
}
