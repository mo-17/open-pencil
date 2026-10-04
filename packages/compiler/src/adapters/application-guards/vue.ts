import type { IRTree } from '#compiler/ir/types'

import { guardDocumentNames } from './emit'

export function vueApplicationGuardsSource(pages: readonly IRTree[], navigation: boolean): string {
  const names = guardDocumentNames(pages)
  const docImport = names.length ? "import { getDocState } from '../lowcode-state'\n" : ''
  const docEntries = names
    .map((name) => `${JSON.stringify(name)}: getDocState(${JSON.stringify(name)})`)
    .join(', ')
  return `import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter, type Router } from 'vue-router'
${docImport}${navigation ? "import { releaseApplicationBack } from '../_application_navigation'\n" : ''}import { policies, routeScope, entryOutcome, allowLeave, registerLeave, notifyGuardInputs, dismissLeaveConfirmation, installUnloadGuard, guardPreviewBootPending, releaseGuardPreviewBoot, subscribeGuardInputs, guardRevision, type GuardScope } from './open-pencil-application-guards'
function readDocuments(): GuardScope { return { ${docEntries} } }
function resolveEntry(router: Router, value: string): { href: string; allowed: boolean; waiting?: boolean } {
  let next = value
  const seen = new Set<string>()
  for (let count = 0; count < 64; count++) {
    const route = router.resolve(next), policy = policies.find((item) => item.route === route.matched.at(-1)?.path)
    if (!policy || seen.has(policy.pageId)) return { href: next, allowed: false }
    seen.add(policy.pageId)
    const outcome = entryOutcome(policy, { ...readDocuments(), ...routeScope(route.fullPath, route.params) })
    if (outcome.allowed || outcome.waiting) return { href: next, ...outcome }
    if (!outcome.fallback) return { href: next, allowed: false }
    next = outcome.fallback
  }
  return { href: next, allowed: false }
}
export function useApplicationGuardPage(pageId: Ref<string>) {
  const router = useRouter(), route = useRoute()
  const inputs = ref(guardRevision())
  const removeInputs = subscribeGuardInputs(() => { inputs.value = guardRevision() })
  onBeforeUnmount(removeInputs)
  const outcome = computed(() => {
    void inputs.value
    if (guardPreviewBootPending()) return { allowed: false, waiting: true }
    const policy = policies.find((item) => item.pageId === pageId.value)
    return policy ? entryOutcome(policy, { ...readDocuments(), ...routeScope(route.fullPath, route.params) }) : { allowed: false }
  })
  watch(outcome, (result) => {
    if (result.allowed || result.waiting) return
    dismissLeaveConfirmation()
    const target = resolveEntry(router, route.fullPath)
    if (target.href !== route.fullPath) void router.replace(target.href)
  }, { immediate: true, flush: 'sync' })
  return outcome
}
export function useApplicationGuardNavigationOwner(): (origin: string) => boolean {
  const router = useRouter()
  let active = true
  onBeforeUnmount(() => { active = false })
  return (origin) => active && router.currentRoute.value.fullPath === origin
}
export function useApplicationLeave(pageId: string, read: () => GuardScope): void {
  const router = useRouter(), route = useRoute()
  let remove = () => {}
  const stop = watch(() => route.fullPath.split('#')[0], (owner) => {
    remove()
    remove = registerLeave(pageId, owner, () => ({ ...readDocuments(), ...routeScope(route.fullPath, route.params), ...read() }), () => { const result = resolveEntry(router, route.fullPath); return result.allowed && result.href === route.fullPath })
  }, { immediate: true, flush: 'sync' })
  const inputs = watch(read, notifyGuardInputs, { deep: true, flush: 'sync' })
  onBeforeUnmount(() => { stop(); inputs(); remove() })
}
export function installApplicationGuards(router: Router): () => void {
  let generation = 0, confirmation: AbortController | undefined, pendingTarget: string | undefined
  const remove = router.beforeEach(async (to, from) => {
    const version = ++generation
    confirmation?.abort()
    const abort = new AbortController()
    confirmation = abort
    const target = resolveEntry(router, to.fullPath)
    if (!target.allowed && !target.waiting && target.href === to.fullPath) return false
    const next = target.href
    pendingTarget = next
    const accepted = await allowLeave(from.fullPath, next, abort.signal)
    if (version === generation) pendingTarget = undefined
    if (!accepted || abort.signal.aborted || version !== generation) return false
    if (router.currentRoute.value.fullPath !== from.fullPath) return false
    const fresh = resolveEntry(router, to.fullPath)
    if ((!fresh.allowed && !fresh.waiting) || fresh.href !== next) return false
    return next === to.fullPath ? true : { path: next, replace: true }
  })
  const removeAfter = router.afterEach((_to, _from, failure) => { if (failure) { ${navigation ? 'releaseApplicationBack(router)' : ''} } })
  const stopInputs = watch(readDocuments, () => {
    notifyGuardInputs()
    if (pendingTarget) { const fresh = resolveEntry(router, pendingTarget); if ((!fresh.allowed && !fresh.waiting) || fresh.href !== pendingTarget) { confirmation?.abort(); dismissLeaveConfirmation() } }
  }, { deep: true, flush: 'sync' })
  const unload = installUnloadGuard(() => router.currentRoute.value.fullPath)
  const guard: OpenPencilApplicationNavigationGuard = { cancelPending() { confirmation?.abort(); dismissLeaveConfirmation() }, async requestRoute(route, replace = false) {
    if (!route.startsWith('/') || route.startsWith('//')) return false
    releaseGuardPreviewBoot()
    const entry = resolveEntry(router, route)
    if (!entry.allowed && !entry.waiting) return false
    const result = replace ? await router.replace(entry.href) : await router.push(entry.href)
    return !result && router.currentRoute.value.fullPath === route
  } }
  if (typeof window !== 'undefined') {
    window.__opApplicationNavigationGuard = guard
    window.dispatchEvent(new Event('op-application-guards-ready'))
  }
  return () => { generation++; confirmation?.abort(); remove(); removeAfter(); stopInputs(); unload(); if (typeof window !== 'undefined' && window.__opApplicationNavigationGuard === guard) delete window.__opApplicationNavigationGuard }
}
`
}

export function vueApplicationGuardComponent(): string {
  return `<script setup lang="ts">
import { toRef } from 'vue'
import { useApplicationGuardPage } from '../lib/open-pencil-application-guards-vue'
const props = defineProps<{ pageId: string }>()
const outcome = useApplicationGuardPage(toRef(props, 'pageId'))
</script>
<template>
  <slot v-if="outcome.allowed" />
  <section v-else :aria-busy="outcome.waiting || undefined" data-openpencil-guard-unavailable>Page unavailable.</section>
</template>
`
}
