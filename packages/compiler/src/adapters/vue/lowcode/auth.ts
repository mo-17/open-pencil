import { scriptJSON } from '../shared'

export function wrapVueAuthGuard(
  body: string,
  requiresAuth: boolean,
  currentUser: string | undefined
): string {
  if (!requiresAuth) return body
  if (!currentUser) {
    return '    <section data-openpencil-unsupported="auth-guard">Authentication required.</section>\n'
  }
  return `    <template v-if="${currentUser}.signedIn">\n${body}    </template>\n    <section v-else aria-busy="true" data-openpencil-auth-guard>Authentication required.</section>\n`
}

export function buildVueAuthGuardRuntime(currentUser: string, redirect: string): string[] {
  const target = scriptJSON(redirect)
  return [
    `const __opAuthGuardReady = __vueRef(false)`,
    `void __opGetSupabaseClient().auth.getSession().then(({ data }) => {
  __opAuthGuardReady.value = true
  if (!data.session) void __opRouter.replace(${target})
})`,
    `__vueWatch(
  () => Boolean(${currentUser}.value?.signedIn),
  (signedIn) => {
    if (__opAuthGuardReady.value && !signedIn) void __opRouter.replace(${target})
  }
)`
  ]
}
