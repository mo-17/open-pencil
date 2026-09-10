import { computed, onScopeDispose, ref, shallowReactive, shallowRef, watch, type Ref } from 'vue'

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
  readonly readContext?: () => SupabaseBackendProviderStagingReleaseContext
}

export interface SupabaseBackendProviderStagingReleaseContext {
  readonly identity: object
  readGraph(): AppBackendProviderDocumentGraph
  readConfig(): SupabaseConfig | undefined
}

const DEFAULT_DEPENDENCIES: SupabaseBackendProviderStagingReleaseDependencies = Object.freeze({
  service: appDesktopSupabaseBackendStagingReleaseService
})

function createReleaseSession() {
  const state = ref<SupabaseBackendProviderStagingReleaseState>('idle')
  const error = ref<DesktopSupabaseBackendStagingReleaseErrorCode | null>(null)
  const result = shallowRef<DesktopSupabaseBackendStagingReleaseResult | null>(null)
  const target = shallowRef<Readonly<{ projectRef: string; accountId: string }> | null>(null)
  const dispatched = ref(false)
  let runVersion = 0
  let activeController: AbortController | null = null
  let latestOperation: object | null = null
  let cancelUnsentOperation: (() => void) | null = null
  const pendingDispatches = shallowReactive(
    new Map<object, Readonly<{ projectRef: string; accountId: string }>>()
  )

  function cancelBeforeDispatch(): boolean {
    if (state.value === 'outcome-unknown') return false
    if (state.value === 'loading' && dispatched.value) return false
    runVersion += 1
    activeController?.abort()
    activeController = null
    return true
  }

  function reset(): boolean {
    if (pendingDispatches.size > 0) return false
    if (!cancelBeforeDispatch()) return false
    clearKnownState()
    return true
  }

  function clearKnownState(): void {
    if (state.value === 'outcome-unknown') return
    state.value = 'idle'
    error.value = null
    result.value = null
    target.value = null
    dispatched.value = false
  }

  async function release(
    service: DesktopSupabaseBackendStagingReleaseService,
    activeOperations: Set<() => void>,
    context: SupabaseBackendProviderStagingReleaseContext,
    expectedReview: DesktopSupabaseBackendReviewResult | null,
    projectRefConfirmation: string,
    confirmedIndependentStaging: boolean
  ): Promise<void> {
    if (pendingDispatches.size > 0) return
    if (state.value === 'loading' || state.value === 'outcome-unknown' || result.value) return
    if (!expectedReview || !confirmedIndependentStaging) {
      error.value = 'binding-mismatch'
      state.value = 'error'
      return
    }
    cancelBeforeDispatch()
    const version = runVersion
    const operation = {}
    latestOperation = operation
    const controller = new AbortController()
    let operationDispatched = false
    function canAcceptOutcome(outcome: string): boolean {
      if (state.value === 'outcome-unknown') return false
      if (outcome === 'outcome-unknown') return true
      return latestOperation === operation && (version === runVersion || operationDispatched)
    }
    const disposeOperation = () => {
      // A dispatched operation still owns settlement and its eventual receipt.
      if (!operationDispatched) controller.abort()
      if (version === runVersion) {
        activeController = null
        runVersion += 1
        if (!operationDispatched) clearKnownState()
      }
    }
    const cancelUnsent = () => {
      if (!operationDispatched) disposeOperation()
    }
    cancelUnsentOperation = cancelUnsent
    activeOperations.add(disposeOperation)
    activeController = controller
    dispatched.value = false
    state.value = 'loading'
    error.value = null
    result.value = null
    const operationTarget = Object.freeze({
      projectRef: expectedReview.projectRef,
      accountId: expectedReview.accountId
    })
    target.value = operationTarget
    const graph: AppBackendProviderDocumentGraph = Object.freeze({
      get rootId() {
        return context.readGraph().rootId
      },
      getNode(id: string) {
        return context.readGraph().getNode(id)
      }
    })
    try {
      const released = await service.release({
        config: context.readConfig(),
        readConfig: () => context.readConfig(),
        graph,
        reviewed: expectedReview,
        projectRefConfirmation,
        confirmedIndependentStaging: true,
        signal: controller.signal,
        onTransition(transition) {
          if (transition.dispatch !== 'not-dispatched') {
            // Journal precommit may finish after UI cancellation; this evidence still belongs
            // to the original operation even when another run is now selected.
            operationDispatched = true
            pendingDispatches.set(operation, operationTarget)
            if (version === runVersion) dispatched.value = true
          }
        }
      })
      if (!canAcceptOutcome(released.outcome)) return
      result.value = released
      error.value = null
      target.value = operationTarget
      dispatched.value = operationDispatched
      state.value =
        released.outcome === 'failed' || released.outcome === 'cancelled'
          ? 'error'
          : released.outcome
    } catch (cause) {
      const code =
        cause instanceof DesktopSupabaseBackendStagingReleaseError ? cause.code : 'release-failed'
      if (!canAcceptOutcome(code)) return
      error.value = code
      if (code === 'outcome-unknown') {
        result.value = null
        target.value = operationTarget
        dispatched.value = operationDispatched
      }
      state.value = code === 'outcome-unknown' ? 'outcome-unknown' : 'error'
    } finally {
      pendingDispatches.delete(operation)
      activeOperations.delete(disposeOperation)
      if (cancelUnsentOperation === cancelUnsent) cancelUnsentOperation = null
      if (version === runVersion) activeController = null
    }
  }

  const pending = computed(() => state.value !== 'outcome-unknown' && pendingDispatches.size > 0)
  return {
    state: computed(() => (pending.value ? 'loading' : state.value)),
    error: computed(() => (pending.value ? null : error.value)),
    result: computed(() => (pending.value ? null : result.value)),
    target: computed(() =>
      pending.value ? (pendingDispatches.values().next().value ?? null) : target.value
    ),
    dispatched: computed(() => pending.value || dispatched.value),
    release,
    reset,
    cancelUnsent: () => cancelUnsentOperation?.()
  }
}

// Editor identities survive inspector remounts; closed editors remain collectible.
const sessions = new WeakMap<object, ReturnType<typeof createReleaseSession>>()

export function useSupabaseBackendProviderStagingRelease(
  config: Readonly<Ref<SupabaseConfig | undefined>>,
  reviewed: Readonly<Ref<DesktopSupabaseBackendReviewResult | null>>,
  readGraph: () => AppBackendProviderDocumentGraph,
  dependencyOverrides: Partial<SupabaseBackendProviderStagingReleaseDependencies> = {}
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  const localContext: SupabaseBackendProviderStagingReleaseContext = {
    identity: {},
    readGraph,
    readConfig: () => config.value
  }
  const context = computed(() => dependencies.readContext?.() ?? localContext)
  const activeOperations = new Set<() => void>()
  let disposed = false
  const session = computed(() => {
    const identity = context.value.identity
    let selected = sessions.get(identity)
    if (!selected) {
      selected = createReleaseSession()
      sessions.set(identity, selected)
    }
    return selected
  })

  watch(
    () =>
      [
        context.value.identity,
        config.value?.url,
        config.value?.schema,
        reviewed.value?.artifact.manifestDigest
      ] as const,
    ([identity], [previousIdentity]) => {
      if (identity !== previousIdentity) {
        const previous = sessions.get(previousIdentity)
        previous?.cancelUnsent()
      } else {
        session.value.cancelUnsent()
        session.value.reset()
      }
    },
    { flush: 'sync' }
  )

  onScopeDispose(() => {
    disposed = true
    for (const disposeOperation of activeOperations) disposeOperation()
  })

  return {
    state: computed(() => session.value.state.value),
    error: computed(() => session.value.error.value),
    result: computed(() => session.value.result.value),
    target: computed(() => session.value.target.value),
    dispatched: computed(() => session.value.dispatched.value),
    release: (projectRefConfirmation: string, confirmedIndependentStaging: boolean) => {
      if (disposed) return Promise.resolve()
      return session.value.release(
        dependencies.service,
        activeOperations,
        context.value,
        reviewed.value,
        projectRefConfirmation,
        confirmedIndependentStaging
      )
    },
    reset: () => !disposed && session.value.reset()
  }
}
