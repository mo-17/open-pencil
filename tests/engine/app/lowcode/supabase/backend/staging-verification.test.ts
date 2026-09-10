import { describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import { useSupabaseBackendStagingVerification } from '@/app/lowcode/supabase/backend/staging-verification'
import type { AppBackendProviderDocumentGraph } from '@/app/plugins/host/backend-provider'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import {
  DesktopSupabaseBackendStagingVerificationError,
  type DesktopSupabaseBackendStagingVerificationResult,
  type DesktopSupabaseBackendStagingVerificationService
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/verification'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const GRAPH_A: AppBackendProviderDocumentGraph = { rootId: 'root-a', getNode: () => undefined }
const GRAPH_B: AppBackendProviderDocumentGraph = { rootId: 'root-b', getNode: () => undefined }
const GRAPH_C: AppBackendProviderDocumentGraph = { rootId: 'root-c', getNode: () => undefined }

const REVIEWED = Object.freeze({
  artifact: Object.freeze({ manifestDigest: 'A'.repeat(43) }),
  documentDigest: 'B'.repeat(43),
  projectRef: PROJECT_REF,
  accountId: 'account-1',
  grantGeneration: '123e4567-e89b-42d3-a456-426614174000',
  reviewReady: true,
  blockerCount: 0,
  applyAvailable: false,
  applyPerformed: false
}) as DesktopSupabaseBackendReviewResult

function result(
  outcome: 'succeeded' | 'blocked' | 'failed' | 'outcome-unknown' = 'succeeded'
): DesktopSupabaseBackendStagingVerificationResult {
  return Object.freeze({
    receipt: Object.freeze({ outcome }),
    receiptDigest: 'C'.repeat(43),
    productionReleaseReady: false
  }) as DesktopSupabaseBackendStagingVerificationResult
}

function request() {
  return {
    projectRefConfirmation: PROJECT_REF,
    confirmedIndependentStaging: true as const,
    edgeUserAccessToken: 'edge-operation-token',
    storageUserA: { userId: 'user-a', accessToken: 'user-a-operation-token' },
    storageUserB: { userId: 'user-b', accessToken: 'user-b-operation-token' }
  }
}

describe('Supabase staging capability verification composable', () => {
  test('passes a live graph view and the explicit transient authority only after a user action', async () => {
    let currentGraph = GRAPH_A
    const observedRootIds: string[] = []
    let calls = 0
    const service: DesktopSupabaseBackendStagingVerificationService = {
      async verify(input) {
        calls += 1
        observedRootIds.push(input.graph.rootId)
        currentGraph = GRAPH_C
        observedRootIds.push(input.graph.rootId)
        expect(input.edgeUserAccessToken).toBe('edge-operation-token')
        expect(input.storageUserA?.userId).toBe('user-a')
        expect(input.storageUserB?.userId).toBe('user-b')
        return result()
      }
    }
    const config = ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: 'publishable-key-value' })
    const reviewed = ref<DesktopSupabaseBackendReviewResult | null>(REVIEWED)
    const scope = effectScope()
    const verification = scope.run(() =>
      useSupabaseBackendStagingVerification(config, reviewed, () => currentGraph, { service })
    )
    if (!verification) throw new Error('Missing composable')

    expect(calls).toBe(0)
    currentGraph = GRAPH_B
    await verification.verify(request())
    expect(calls).toBe(1)
    expect(observedRootIds).toEqual(['root-b', 'root-c'])
    expect(verification.state.value).toBe('ready')
    expect(verification.result.value?.productionReleaseReady).toBe(false)
    scope.stop()
  })

  test('keeps a run single-flight and aborts it when the project authority changes', async () => {
    let resolveRun: ((value: DesktopSupabaseBackendStagingVerificationResult) => void) | undefined
    let capturedSignal: AbortSignal | undefined
    let calls = 0
    const pending = new Promise<DesktopSupabaseBackendStagingVerificationResult>((resolve) => {
      resolveRun = resolve
    })
    const service: DesktopSupabaseBackendStagingVerificationService = {
      verify(input) {
        calls += 1
        capturedSignal = input.signal
        return pending
      }
    }
    const config = ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: 'publishable-key-value' })
    const reviewed = ref<DesktopSupabaseBackendReviewResult | null>(REVIEWED)
    const scope = effectScope()
    const verification = scope.run(() =>
      useSupabaseBackendStagingVerification(config, reviewed, () => GRAPH_A, { service })
    )
    if (!verification) throw new Error('Missing composable')

    const first = verification.verify(request())
    await verification.verify(request())
    expect(calls).toBe(1)
    config.value = { ...config.value, anonKey: 'different-publishable-key' }
    await nextTick()
    expect(capturedSignal?.aborted).toBe(true)
    expect(verification.state.value).toBe('idle')
    resolveRun?.(result())
    await first
    expect(verification.result.value).toBeNull()
    scope.stop()
  })

  test('does not abort Host settlement when the scope is disposed after durable dispatch', async () => {
    let finish!: () => void
    const remote = new Promise<void>((resolve) => {
      finish = resolve
    })
    let capturedSignal: AbortSignal | undefined
    let hostSettled = false
    const service: DesktopSupabaseBackendStagingVerificationService = {
      async verify(input) {
        capturedSignal = input.signal
        input.onDispatch?.()
        await remote
        hostSettled = true
        return result()
      }
    }
    const scope = effectScope()
    const verification = scope.run(() =>
      useSupabaseBackendStagingVerification(
        ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: 'publishable-key-value' }),
        ref(REVIEWED),
        () => GRAPH_A,
        { service }
      )
    )
    if (!verification) throw new Error('Missing composable')

    const operation = verification.verify(request())
    await Promise.resolve()
    expect(verification.dispatched.value).toBe(true)
    scope.stop()
    expect(capturedSignal?.aborted).toBe(false)
    finish()
    await operation
    expect(hostSettled).toBe(true)
  })

  test('turns a post-dispatch target change into a reconciliation latch without aborting Host work', async () => {
    let finish!: () => void
    const remote = new Promise<void>((resolve) => {
      finish = resolve
    })
    let capturedSignal: AbortSignal | undefined
    const service: DesktopSupabaseBackendStagingVerificationService = {
      async verify(input) {
        capturedSignal = input.signal
        input.onDispatch?.()
        await remote
        return result()
      }
    }
    const config = ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: 'publishable-key-value' })
    const scope = effectScope()
    const verification = scope.run(() =>
      useSupabaseBackendStagingVerification(config, ref(REVIEWED), () => GRAPH_A, { service })
    )
    if (!verification) throw new Error('Missing composable')

    const operation = verification.verify(request())
    await Promise.resolve()
    config.value = { ...config.value, anonKey: 'different-publishable-key' }
    await nextTick()
    expect(capturedSignal?.aborted).toBe(false)
    expect(verification.state.value).toBe('outcome-unknown')
    expect(verification.error.value).toBe('reconciliation-required')
    finish()
    await operation
    expect(verification.result.value).toBeNull()
    scope.stop()
  })

  test('locks an outcome-unknown result against blind retry or reset', async () => {
    let calls = 0
    const service: DesktopSupabaseBackendStagingVerificationService = {
      async verify() {
        calls += 1
        return result('outcome-unknown')
      }
    }
    const scope = effectScope()
    const verification = scope.run(() =>
      useSupabaseBackendStagingVerification(
        ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: 'publishable-key-value' }),
        ref(REVIEWED),
        () => GRAPH_A,
        { service }
      )
    )
    if (!verification) throw new Error('Missing composable')

    await verification.verify(request())
    verification.reset()
    await verification.verify(request())
    expect(calls).toBe(1)
    expect(verification.state.value).toBe('outcome-unknown')
    expect(verification.result.value?.receipt.outcome).toBe('outcome-unknown')
    scope.stop()
  })

  test('maps typed failures and keeps JWT inputs out of reactive v-model state', async () => {
    const service: DesktopSupabaseBackendStagingVerificationService = {
      async verify() {
        throw new DesktopSupabaseBackendStagingVerificationError('schema-not-applied')
      }
    }
    const scope = effectScope()
    const verification = scope.run(() =>
      useSupabaseBackendStagingVerification(
        ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: 'publishable-key-value' }),
        ref(REVIEWED),
        () => GRAPH_A,
        { service }
      )
    )
    if (!verification) throw new Error('Missing composable')
    await verification.verify(request())
    expect(verification.state.value).toBe('error')
    expect(verification.error.value).toBe('schema-not-applied')
    scope.stop()

    const component = await Bun.file(
      'src/components/properties/Lowcode/SupabaseBackendStagingVerification.vue'
    ).text()
    for (const testId of [
      'lowcode-supabase-backend-capability-edge-token',
      'lowcode-supabase-backend-capability-user-a-token',
      'lowcode-supabase-backend-capability-user-b-token'
    ]) {
      const inputStart = component.indexOf(`data-test-id="${testId}"`)
      expect(inputStart).toBeGreaterThan(-1)
      expect(component.slice(Math.max(0, inputStart - 180), inputStart + 180)).not.toContain(
        'v-model'
      )
    }
    expect(component).toContain('function clearTokenInputs(): void')
    expect(component).toContain("if (input) input.value = ''")
    expect(component.match(/clearTokenInputs\(\)/gu)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })
})
