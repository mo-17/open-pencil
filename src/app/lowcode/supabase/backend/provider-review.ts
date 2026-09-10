import { onScopeDispose, readonly, ref, shallowReadonly, shallowRef, watch, type Ref } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import type { AppBackendProviderDocumentGraph } from '@/app/plugins/host/backend-provider'
import {
  DesktopSupabaseBackendReviewError,
  type DesktopSupabaseBackendReviewErrorCode,
  type DesktopSupabaseBackendReviewResult,
  type DesktopSupabaseBackendReviewService
} from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import { appDesktopSupabaseBackendReviewService } from '@/app/plugins/host/deployment/desktop/supabase/backend/review-app'
import type { DesktopSupabaseBackendTarget } from '@/app/plugins/host/deployment/desktop/supabase/backend/target'

export type SupabaseBackendProviderReviewState = 'idle' | 'loading' | 'ready' | 'error'

export interface SupabaseBackendProviderReviewDependencies {
  readonly service: DesktopSupabaseBackendReviewService
  readonly readTarget: () => DesktopSupabaseBackendTarget
}

const DEFAULT_DEPENDENCIES: SupabaseBackendProviderReviewDependencies = Object.freeze({
  service: appDesktopSupabaseBackendReviewService,
  readTarget: () => 'react'
})

export function useSupabaseBackendProviderReview(
  config: Readonly<Ref<SupabaseConfig | undefined>>,
  readGraph: () => AppBackendProviderDocumentGraph,
  dependencyOverrides: Partial<SupabaseBackendProviderReviewDependencies> = {}
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  // Opening a .fig replaces the editor graph through a manifest shell before the final graph.
  // Keep a live view so review and its authority revalidation never read that stale shell.
  const graph: AppBackendProviderDocumentGraph = Object.freeze({
    get rootId() {
      return readGraph().rootId
    },
    getNode(id: string) {
      return readGraph().getNode(id)
    }
  })
  const state = ref<SupabaseBackendProviderReviewState>('idle')
  const error = ref<DesktopSupabaseBackendReviewErrorCode | null>(null)
  const result = shallowRef<DesktopSupabaseBackendReviewResult | null>(null)
  let runVersion = 0
  let activeController: AbortController | null = null

  function cancelActiveRun(): number {
    runVersion += 1
    activeController?.abort()
    activeController = null
    return runVersion
  }

  function reset(): void {
    cancelActiveRun()
    state.value = 'idle'
    error.value = null
    result.value = null
  }

  async function review(stagedExecutionPlan?: unknown): Promise<void> {
    const version = cancelActiveRun()
    const controller = new AbortController()
    activeController = controller
    state.value = 'loading'
    error.value = null
    result.value = null
    try {
      const reviewed = await dependencies.service.review({
        config: config.value,
        readConfig: () => config.value,
        graph,
        target: dependencies.readTarget(),
        ...(stagedExecutionPlan === undefined ? {} : { stagedExecutionPlan }),
        signal: controller.signal
      })
      if (version !== runVersion || controller.signal.aborted) return
      result.value = reviewed
      state.value = 'ready'
    } catch (cause) {
      if (version !== runVersion || controller.signal.aborted) return
      error.value =
        cause instanceof DesktopSupabaseBackendReviewError ? cause.code : 'review-failed'
      state.value = 'error'
    } finally {
      if (version === runVersion) activeController = null
    }
  }

  watch(
    () => [config.value?.url, config.value?.schema, dependencies.readTarget()],
    () => reset(),
    { flush: 'sync' }
  )

  onScopeDispose(() => reset())

  return {
    state: readonly(state),
    error: readonly(error),
    result: shallowReadonly(result),
    review,
    reset
  }
}
