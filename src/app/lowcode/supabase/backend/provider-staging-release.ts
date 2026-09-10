import { onScopeDispose, readonly, ref, shallowReadonly, shallowRef, watch, type Ref } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import type { AppBackendProviderDocumentGraph } from '@/app/plugins/host/backend-provider'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import {
  DesktopSupabaseBackendStagingReleaseError,
  type DesktopSupabaseBackendStagingReleaseErrorCode,
  type DesktopSupabaseBackendStagingReleaseResult,
  type DesktopSupabaseBackendStagingReleaseService
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/release'
import { appDesktopSupabaseBackendStagingReleaseService } from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/release-app'

export type SupabaseBackendProviderStagingReleaseState =
  | 'idle'
  | 'loading'
  | 'succeeded'
  | 'blocked'
  | 'outcome-unknown'
  | 'error'

export interface SupabaseBackendProviderStagingReleaseDependencies {
  readonly service: DesktopSupabaseBackendStagingReleaseService
}

const DEFAULT_DEPENDENCIES: SupabaseBackendProviderStagingReleaseDependencies = Object.freeze({
  service: appDesktopSupabaseBackendStagingReleaseService
})

export function useSupabaseBackendProviderStagingRelease(
  config: Readonly<Ref<SupabaseConfig | undefined>>,
  reviewed: Readonly<Ref<DesktopSupabaseBackendReviewResult | null>>,
  readGraph: () => AppBackendProviderDocumentGraph,
  dependencyOverrides: Partial<SupabaseBackendProviderStagingReleaseDependencies> = {}
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  const graph: AppBackendProviderDocumentGraph = Object.freeze({
    get rootId() {
      return readGraph().rootId
    },
    getNode(id: string) {
      return readGraph().getNode(id)
    }
  })
  const state = ref<SupabaseBackendProviderStagingReleaseState>('idle')
  const error = ref<DesktopSupabaseBackendStagingReleaseErrorCode | null>(null)
  const result = shallowRef<DesktopSupabaseBackendStagingReleaseResult | null>(null)
  const dispatched = ref(false)
  let runVersion = 0
  let activeController: AbortController | null = null

  function cancelBeforeDispatch(): boolean {
    if (state.value === 'loading' && dispatched.value) return false
    runVersion += 1
    activeController?.abort()
    activeController = null
    return true
  }

  function wasDispatched(): boolean {
    return dispatched.value
  }

  function reset(): boolean {
    if (!cancelBeforeDispatch()) return false
    state.value = 'idle'
    error.value = null
    result.value = null
    dispatched.value = false
    return true
  }

  async function release(
    projectRefConfirmation: string,
    confirmedIndependentStaging: boolean
  ): Promise<void> {
    if (state.value === 'loading' || state.value === 'outcome-unknown' || result.value) return
    const expectedReview = reviewed.value
    if (!expectedReview || !confirmedIndependentStaging) {
      error.value = 'binding-mismatch'
      state.value = 'error'
      return
    }
    cancelBeforeDispatch()
    const version = runVersion
    const controller = new AbortController()
    activeController = controller
    dispatched.value = false
    state.value = 'loading'
    error.value = null
    result.value = null
    try {
      const released = await dependencies.service.release({
        config: config.value,
        readConfig: () => config.value,
        graph,
        reviewed: expectedReview,
        projectRefConfirmation,
        confirmedIndependentStaging: true,
        signal: controller.signal,
        onTransition(transition) {
          if (version !== runVersion) return
          if (transition.dispatch !== 'not-dispatched') dispatched.value = true
        }
      })
      if (version !== runVersion && !wasDispatched()) return
      result.value = released
      state.value =
        released.outcome === 'failed' || released.outcome === 'cancelled'
          ? 'error'
          : released.outcome
    } catch (cause) {
      if (version !== runVersion && !wasDispatched()) return
      const code =
        cause instanceof DesktopSupabaseBackendStagingReleaseError ? cause.code : 'release-failed'
      error.value = code
      state.value = code === 'outcome-unknown' ? 'outcome-unknown' : 'error'
    } finally {
      if (version === runVersion) activeController = null
    }
  }

  watch(
    () => [config.value?.url, config.value?.schema, reviewed.value?.artifact.manifestDigest],
    () => {
      reset()
    }
  )

  onScopeDispose(() => {
    // Once dispatched, the controller must finish settlement/verification and persist its receipt.
    if (!dispatched.value) activeController?.abort()
    activeController = null
    runVersion += 1
  })

  return {
    state: readonly(state),
    error: readonly(error),
    result: shallowReadonly(result),
    dispatched: readonly(dispatched),
    release,
    reset
  }
}
