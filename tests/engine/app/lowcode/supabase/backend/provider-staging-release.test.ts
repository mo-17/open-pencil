import { describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import { useSupabaseBackendProviderStagingRelease } from '@/app/lowcode/supabase/backend/provider-staging-release'
import {
  DesktopSupabaseBackendStagingReleaseError,
  type DesktopSupabaseBackendStagingReleaseResult,
  type DesktopSupabaseBackendStagingReleaseService
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/release'

import {
  PROJECT_REF,
  PROJECT_URL,
  GRAPH,
  REVIEW,
  SUCCEEDED,
  UNKNOWN,
  FAILED
} from './staging-release/helpers'

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

  for (const outcome of ['returned', 'thrown'] as const) {
    test.each(['configuration', 'review', 'explicit reset'] as const)(
      `retains a ${outcome} terminal unknown outcome after %s changes`,
      async (change) => {
        let calls = 0
        const config = ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' })
        const reviewed = ref(REVIEW)
        const service: DesktopSupabaseBackendStagingReleaseService = {
          async release(input) {
            calls += 1
            input.onTransition?.({ dispatch: 'dispatched' } as Parameters<
              NonNullable<typeof input.onTransition>
            >[0])
            if (outcome === 'thrown') {
              throw new DesktopSupabaseBackendStagingReleaseError('outcome-unknown')
            }
            return UNKNOWN
          }
        }
        const scope = effectScope()
        const release = scope.run(() =>
          useSupabaseBackendProviderStagingRelease(config, reviewed, () => GRAPH, { service })
        )
        if (!release) throw new Error('Missing release composable')

        try {
          await release.release(PROJECT_REF, true)
          expect(release.state.value).toBe('outcome-unknown')
          if (change === 'configuration') config.value = { ...config.value, schema: 'private' }
          else if (change === 'review') {
            reviewed.value = {
              ...REVIEW,
              artifact: { ...REVIEW.artifact, manifestDigest: 'changed-review-digest' }
            }
          } else expect(release.reset()).toBe(false)
          await nextTick()

          expect(release.state.value).toBe('outcome-unknown')
          expect(release.dispatched.value).toBe(true)
          expect(release.result.value).toBe(outcome === 'returned' ? UNKNOWN : null)
          expect(release.error.value).toBe(outcome === 'thrown' ? 'outcome-unknown' : null)
          await release.release(PROJECT_REF, true)
          expect(calls).toBe(1)
        } finally {
          scope.stop()
        }
      }
    )
  }
})
