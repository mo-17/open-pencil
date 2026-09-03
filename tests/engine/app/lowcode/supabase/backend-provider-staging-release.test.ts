import { describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import { useSupabaseBackendProviderStagingRelease } from '@/app/lowcode/supabase/backend-provider-staging-release'
import type { AppBackendProviderDocumentGraph } from '@/app/plugins/host/backend-provider'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop-supabase-backend-review'
import {
  DesktopSupabaseBackendStagingReleaseError,
  type DesktopSupabaseBackendStagingReleaseResult,
  type DesktopSupabaseBackendStagingReleaseService
} from '@/app/plugins/host/deployment/desktop-supabase-backend-staging-release'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const GRAPH: AppBackendProviderDocumentGraph = {
  rootId: 'root-1',
  getNode: () => undefined
}
const REVIEW = Object.freeze({
  artifact: { manifestDigest: 'review-digest' },
  projectRef: PROJECT_REF
}) as DesktopSupabaseBackendReviewResult
const SUCCEEDED = Object.freeze({
  outcome: 'succeeded'
}) as DesktopSupabaseBackendStagingReleaseResult
const UNKNOWN = Object.freeze({
  outcome: 'outcome-unknown'
}) as DesktopSupabaseBackendStagingReleaseResult
const FAILED = Object.freeze({
  outcome: 'failed',
  receipt: Object.freeze({
    failure: Object.freeze({ code: 'supabase-staging-apply-not-eligible', outcomeUnknown: false })
  })
}) as DesktopSupabaseBackendStagingReleaseResult

describe('Supabase Backend Provider staging release composable', () => {
  test('single-flights duplicate Apply clicks', async () => {
    let calls = 0
    let finish: ((value: DesktopSupabaseBackendStagingReleaseResult) => void) | undefined
    const pending = new Promise<DesktopSupabaseBackendStagingReleaseResult>((resolve) => {
      finish = resolve
    })
    const service: DesktopSupabaseBackendStagingReleaseService = {
      release: async () => {
        calls += 1
        return pending
      }
    }
    const scope = effectScope()
    const release = scope.run(() =>
      useSupabaseBackendProviderStagingRelease(
        ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' }),
        ref(REVIEW),
        () => GRAPH,
        { service }
      )
    )
    if (!release) throw new Error('Missing release composable')

    const first = release.release(PROJECT_REF, true)
    await release.release(PROJECT_REF, true)
    expect(calls).toBe(1)
    expect(release.state.value).toBe('loading')
    finish?.(SUCCEEDED)
    await first
    expect(release.state.value).toBe('succeeded')
    scope.stop()
  })

  test('retains a known failed receipt and locks direct retries', async () => {
    let calls = 0
    const service: DesktopSupabaseBackendStagingReleaseService = {
      async release() {
        calls += 1
        return FAILED
      }
    }
    const scope = effectScope()
    const release = scope.run(() =>
      useSupabaseBackendProviderStagingRelease(
        ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' }),
        ref(REVIEW),
        () => GRAPH,
        { service }
      )
    )
    if (!release) throw new Error('Missing release composable')

    await release.release(PROJECT_REF, true)
    await release.release(PROJECT_REF, true)

    expect(calls).toBe(1)
    expect(release.state.value).toBe('error')
    expect(release.error.value).toBeNull()
    expect(release.result.value).toBe(FAILED)
    expect(release.result.value?.receipt.failure?.code).toBe('supabase-staging-apply-not-eligible')
    scope.stop()
  })

  test('aborts and discards a pre-dispatch run when configuration changes', async () => {
    let observedSignal: AbortSignal | undefined
    let finish: ((value: DesktopSupabaseBackendStagingReleaseResult) => void) | undefined
    const pending = new Promise<DesktopSupabaseBackendStagingReleaseResult>((resolve) => {
      finish = resolve
    })
    const config = ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' })
    const service: DesktopSupabaseBackendStagingReleaseService = {
      release: async (input) => {
        observedSignal = input.signal
        return pending
      }
    }
    const scope = effectScope()
    const release = scope.run(() =>
      useSupabaseBackendProviderStagingRelease(config, ref(REVIEW), () => GRAPH, { service })
    )
    if (!release) throw new Error('Missing release composable')

    const operation = release.release(PROJECT_REF, true)
    config.value = { ...config.value, schema: 'private' }
    await nextTick()
    expect(observedSignal?.aborted).toBe(true)
    expect(release.state.value).toBe('idle')
    finish?.(SUCCEEDED)
    await operation
    expect(release.result.value).toBeNull()
    scope.stop()
  })

  test('keeps the terminal receipt visible when authority changes after dispatch', async () => {
    let finish: ((value: DesktopSupabaseBackendStagingReleaseResult) => void) | undefined
    let markDispatched: (() => void) | undefined
    const dispatched = new Promise<void>((resolve) => {
      markDispatched = resolve
    })
    const pending = new Promise<DesktopSupabaseBackendStagingReleaseResult>((resolve) => {
      finish = resolve
    })
    const config = ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' })
    const service: DesktopSupabaseBackendStagingReleaseService = {
      async release(input) {
        input.onTransition?.({ dispatch: 'dispatched' } as Parameters<
          NonNullable<typeof input.onTransition>
        >[0])
        markDispatched?.()
        return pending
      }
    }
    const scope = effectScope()
    const release = scope.run(() =>
      useSupabaseBackendProviderStagingRelease(config, ref(REVIEW), () => GRAPH, { service })
    )
    if (!release) throw new Error('Missing release composable')

    const operation = release.release(PROJECT_REF, true)
    await dispatched
    expect(release.dispatched.value).toBe(true)
    config.value = { ...config.value, schema: 'private' }
    await nextTick()
    expect(release.state.value).toBe('loading')
    finish?.(UNKNOWN)
    await operation
    expect(release.state.value).toBe('outcome-unknown')
    expect(release.result.value).toBe(UNKNOWN)
    scope.stop()
  })

  test('locks a thrown post-dispatch unknown outcome against direct retries', async () => {
    let calls = 0
    const service: DesktopSupabaseBackendStagingReleaseService = {
      async release(input) {
        calls += 1
        input.onTransition?.({ dispatch: 'dispatched' } as Parameters<
          NonNullable<typeof input.onTransition>
        >[0])
        throw new DesktopSupabaseBackendStagingReleaseError('outcome-unknown')
      }
    }
    const scope = effectScope()
    const release = scope.run(() =>
      useSupabaseBackendProviderStagingRelease(
        ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' }),
        ref(REVIEW),
        () => GRAPH,
        { service }
      )
    )
    if (!release) throw new Error('Missing release composable')

    await release.release(PROJECT_REF, true)
    await release.release(PROJECT_REF, true)
    expect(calls).toBe(1)
    expect(release.state.value).toBe('outcome-unknown')
    expect(release.error.value).toBe('outcome-unknown')
    scope.stop()
  })
})
