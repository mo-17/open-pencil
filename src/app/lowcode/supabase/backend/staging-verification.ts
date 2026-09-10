import { onScopeDispose, readonly, shallowReadonly, shallowRef, watch, type Ref } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import type { AppBackendProviderDocumentGraph } from '@/app/plugins/host/backend-provider'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import {
  DesktopSupabaseBackendStagingVerificationError,
  type DesktopSupabaseBackendStagingVerificationErrorCode,
  type DesktopSupabaseBackendStagingVerificationResult,
  type DesktopSupabaseBackendStagingVerificationService,
  type DesktopSupabaseStagingTestUserInput
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/verification'
import { appDesktopSupabaseBackendStagingVerificationService } from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/verification-app'

export type SupabaseBackendStagingVerificationState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'outcome-unknown'

export interface SupabaseBackendStagingVerificationRequest {
  readonly projectRefConfirmation: string
  readonly confirmedIndependentStaging: boolean
  readonly edgeUserAccessToken?: string
  readonly storageUserA?: DesktopSupabaseStagingTestUserInput
  readonly storageUserB?: DesktopSupabaseStagingTestUserInput
  readonly tenantPartitions?: Readonly<
    Record<string, Readonly<{ allowedPartition: string; deniedPartition: string }>>
  >
}

export interface SupabaseBackendStagingVerificationDependencies {
  readonly service: DesktopSupabaseBackendStagingVerificationService
}

const DEFAULT_DEPENDENCIES: SupabaseBackendStagingVerificationDependencies = Object.freeze({
  service: appDesktopSupabaseBackendStagingVerificationService
})

export function useSupabaseBackendStagingVerification(
  config: Readonly<Ref<SupabaseConfig | undefined>>,
  reviewed: Readonly<Ref<DesktopSupabaseBackendReviewResult | null>>,
  readGraph: () => AppBackendProviderDocumentGraph,
  dependencyOverrides: Partial<SupabaseBackendStagingVerificationDependencies> = {}
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  // Opening a document can replace the SceneGraph instance while a request is in flight.
  // Keep the authority view live so every Host revalidation observes the current graph.
  const graph: AppBackendProviderDocumentGraph = Object.freeze({
    get rootId() {
      return readGraph().rootId
    },
    getNode(id: string) {
      return readGraph().getNode(id)
    }
  })
  const state = shallowRef<SupabaseBackendStagingVerificationState>('idle')
  const error = shallowRef<DesktopSupabaseBackendStagingVerificationErrorCode | null>(null)
  const result = shallowRef<DesktopSupabaseBackendStagingVerificationResult | null>(null)
  const dispatched = shallowRef(false)
  let generation = 0
  let controller: AbortController | null = null

  function cancelActiveRun(): number {
    generation += 1
    if (!dispatched.value) controller?.abort()
    controller = null
    return generation
  }

  function reset(): void {
    if (state.value === 'outcome-unknown') return
    if (state.value === 'loading' && dispatched.value) {
      cancelActiveRun()
      state.value = 'outcome-unknown'
      error.value = 'reconciliation-required'
      result.value = null
      return
    }
    cancelActiveRun()
    dispatched.value = false
    state.value = 'idle'
    error.value = null
    result.value = null
    dispatched.value = false
  }

  async function verify(request: SupabaseBackendStagingVerificationRequest): Promise<void> {
    if (state.value === 'loading' || state.value === 'outcome-unknown') return
    const expectedReview = reviewed.value
    if (!expectedReview || !request.confirmedIndependentStaging) return
    const version = cancelActiveRun()
    const activeController = new AbortController()
    controller = activeController
    state.value = 'loading'
    error.value = null
    result.value = null
    try {
      const verified = await dependencies.service.verify({
        config: config.value,
        readConfig: () => config.value,
        graph,
        reviewed: expectedReview,
        projectRefConfirmation: request.projectRefConfirmation,
        confirmedIndependentStaging: true,
        ...(request.edgeUserAccessToken
          ? { edgeUserAccessToken: request.edgeUserAccessToken }
          : {}),
        ...(request.storageUserA ? { storageUserA: request.storageUserA } : {}),
        ...(request.storageUserB ? { storageUserB: request.storageUserB } : {}),
        ...(request.tenantPartitions ? { tenantPartitions: request.tenantPartitions } : {}),
        onDispatch: () => {
          if (version === generation) dispatched.value = true
        },
        signal: activeController.signal
      })
      if (version !== generation || activeController.signal.aborted) return
      result.value = verified
      state.value = verified.receipt.outcome === 'outcome-unknown' ? 'outcome-unknown' : 'ready'
      if (verified.receipt.outcome !== 'outcome-unknown') dispatched.value = false
    } catch (cause) {
      if (version !== generation || activeController.signal.aborted) return
      error.value =
        cause instanceof DesktopSupabaseBackendStagingVerificationError
          ? cause.code
          : 'verification-failed'
      state.value = error.value === 'reconciliation-required' ? 'outcome-unknown' : 'error'
      if (state.value !== 'outcome-unknown') dispatched.value = false
    } finally {
      if (version === generation) controller = null
    }
  }

  watch(
    () => [
      config.value?.url,
      config.value?.anonKey,
      config.value?.schema,
      reviewed.value?.artifact.manifestDigest
    ],
    () => reset()
  )

  onScopeDispose(() => {
    if (state.value !== 'outcome-unknown') cancelActiveRun()
  })

  return {
    state: readonly(state),
    error: readonly(error),
    result: shallowReadonly(result),
    dispatched: readonly(dispatched),
    verify,
    reset
  }
}
