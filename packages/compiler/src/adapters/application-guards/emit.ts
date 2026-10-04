import type { IRTree } from '#compiler/ir/types'

import { derivePagePaths } from '../react/route-paths'

export const APPLICATION_GUARDS_FILE = 'src/lib/open-pencil-application-guards.ts'
export const REACT_APPLICATION_GUARDS_FILE = 'src/components/_open-pencil-application-guards.tsx'
export const VUE_APPLICATION_GUARDS_FILE = 'src/lib/open-pencil-application-guards-vue.ts'
export const VUE_APPLICATION_GUARD_COMPONENT = 'src/components/_open-pencil-application-guard.vue'

export function hasApplicationGuards(pages: readonly IRTree[]): boolean {
  return pages.some((page) => page.applicationGuardsEnabled)
}
export function applicationGuardPolicies(pages: readonly IRTree[]) {
  return derivePagePaths(pages).map(({ ir, route }) => ({
    pageId: ir.pageId,
    route,
    ...(ir.applicationEnterGuard ? { enter: ir.applicationEnterGuard } : {}),
    ...(ir.applicationLeaveConfirm ? { leave: ir.applicationLeaveConfirm } : {}),
    ...(ir.requiresAuth
      ? { auth: { fallback: ir.authRedirect ?? '/login', ready: Boolean(ir.backendClient) } }
      : {})
  }))
}
export function guardDocumentNames(pages: readonly IRTree[]): string[] {
  const declared = new Set(pages[0]?.docStates.map((state) => state.name))
  const references = pages.flatMap((page) => [
    ...(page.applicationEnterGuard?.references ?? []),
    ...(page.applicationLeaveConfirm?.references ?? []),
    ...(page.requiresAuth ? ['$currentUser'] : [])
  ])
  return [...new Set(references.filter((name) => declared.has(name)))].sort()
}

export function reactGuardPageImports(ir: IRTree, prefix: string, navigate: boolean): string {
  const imports = []
  if (ir.applicationGuardsEnabled && navigate)
    imports.push('useApplicationGuardNavigate as useNavigate')
  if (ir.applicationLeaveConfirm) imports.push('useApplicationLeave as __opUseApplicationLeave')
  return imports.length
    ? `import { ${imports.join(', ')} } from '${prefix}_open-pencil-application-guards'\n`
    : ''
}
export function reactGuardLeaveHook(ir: IRTree): string {
  return ir.applicationLeaveConfirm
    ? `  __opUseApplicationLeave(${JSON.stringify(ir.pageId)}, () => ({ ${ir.states.map((state) => `${JSON.stringify(state.name)}: ${state.name}`).join(', ')} }))`
    : ''
}
