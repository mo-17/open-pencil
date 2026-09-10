import { computed, effectScope, ref, shallowRef } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import {
  useSupabaseBackendProviderStagingRelease,
  type SupabaseBackendProviderStagingReleaseContext
} from '@/app/lowcode/supabase/backend/provider-staging-release'
import type { AppBackendProviderDocumentGraph } from '@/app/plugins/host/backend-provider'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import {
  type DesktopSupabaseBackendStagingReleaseInput,
  type DesktopSupabaseBackendStagingReleaseResult,
  type DesktopSupabaseBackendStagingReleaseService
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/release'

export const PROJECT_REF = 'enekobitnhobuiuamvqj'
export const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
export const GRAPH: AppBackendProviderDocumentGraph = {
  rootId: 'root-1',
  getNode: () => undefined
}
export const REVIEW = Object.freeze({
  artifact: { manifestDigest: 'review-digest' },
  projectRef: PROJECT_REF,
  accountId: 'account-1'
}) as DesktopSupabaseBackendReviewResult
export const SUCCEEDED = Object.freeze({
  outcome: 'succeeded'
}) as DesktopSupabaseBackendStagingReleaseResult
export const UNKNOWN = Object.freeze({
  outcome: 'outcome-unknown'
}) as DesktopSupabaseBackendStagingReleaseResult
export const FAILED = Object.freeze({
  outcome: 'failed',
  receipt: Object.freeze({
    failure: Object.freeze({ code: 'supabase-staging-apply-not-eligible', outcomeUnknown: false })
  })
}) as DesktopSupabaseBackendStagingReleaseResult

export function createContext(rootId: string) {
  const graph = shallowRef<AppBackendProviderDocumentGraph>({ ...GRAPH, rootId })
  const config = ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' })
  return {
    identity: {},
    graph,
    config,
    readGraph: () => graph.value,
    readConfig: () => config.value
  }
}

export function mountRelease(
  service: DesktopSupabaseBackendStagingReleaseService,
  readContext: () => SupabaseBackendProviderStagingReleaseContext
) {
  const scope = effectScope()
  const reviewed = ref(REVIEW)
  const release = scope.run(() =>
    useSupabaseBackendProviderStagingRelease(
      computed(() => readContext().readConfig()),
      reviewed,
      () => readContext().readGraph(),
      { service, readContext }
    )
  )
  if (!release) throw new Error('Missing release composable')
  return { scope, release, reviewed }
}

export function deferredRelease() {
  let finish: ((value: DesktopSupabaseBackendStagingReleaseResult) => void) | undefined
  const promise = new Promise<DesktopSupabaseBackendStagingReleaseResult>((resolve) => {
    finish = resolve
  })
  return { promise, finish: (value: DesktopSupabaseBackendStagingReleaseResult) => finish?.(value) }
}

export function markDispatched(input: DesktopSupabaseBackendStagingReleaseInput) {
  input.onTransition?.({ dispatch: 'dispatched' } as Parameters<
    NonNullable<typeof input.onTransition>
  >[0])
}
