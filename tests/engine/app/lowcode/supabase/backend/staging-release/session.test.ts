import { describe, expect, test } from 'bun:test'

import { shallowRef } from 'vue'

import {
  DesktopSupabaseBackendStagingReleaseError,
  type DesktopSupabaseBackendStagingReleaseInput
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/release'

import {
  PROJECT_REF,
  GRAPH,
  REVIEW,
  SUCCEEDED,
  UNKNOWN,
  createContext,
  mountRelease,
  deferredRelease,
  markDispatched
} from './helpers'

describe('Supabase staging release session lifecycle', () => {
  test('exposes late dispatch settlement before the unknown result and hides newer known receipts', async () => {
    const context = createContext('first')
    const pending = [deferredRelease(), deferredRelease()]
    const inputs: DesktopSupabaseBackendStagingReleaseInput[] = []
    const { scope, release, reviewed } = mountRelease(
      {
        async release(input) {
          inputs.push(input)
          return pending[inputs.length - 1].promise
        }
      },
      () => context
    )
    const first = release.release(PROJECT_REF, true)
    expect(release.reset()).toBe(true)
    reviewed.value = { ...REVIEW, projectRef: 'abcdefghijklmnopqrst', accountId: 'account-2' }
    const second = release.release('abcdefghijklmnopqrst', true)
    try {
      markDispatched(inputs[0])
      expect(release.state.value).toBe('loading')
      expect(release.dispatched.value).toBe(true)
      expect(release.target.value).toEqual({ projectRef: PROJECT_REF, accountId: 'account-1' })
      expect(release.reset()).toBe(false)
      await release.release('abcdefghijklmnopqrst', true)
      expect(inputs).toHaveLength(2)
      pending[1].finish(SUCCEEDED)
      await second
      expect(release.state.value).toBe('loading')
      expect(release.result.value).toBeNull()
      expect(release.error.value).toBeNull()
      expect(release.target.value).toEqual({ projectRef: PROJECT_REF, accountId: 'account-1' })
      pending[0].finish(UNKNOWN)
      await first
      expect(release.state.value).toBe('outcome-unknown')
      expect(release.result.value).toBe(UNKNOWN)
      expect(release.target.value).toEqual({ projectRef: PROJECT_REF, accountId: 'account-1' })
    } finally {
      pending[0].finish(UNKNOWN)
      pending[1].finish(SUCCEEDED)
      await Promise.all([first, second])
      scope.stop()
    }
  })

  test('an unmounted scope cannot reset or abort a remounted scope operation', async () => {
    const context = createContext('first')
    const first = mountRelease({ release: async () => SUCCEEDED }, () => context)
    first.scope.stop()
    const pending = deferredRelease()
    let signal: AbortSignal | undefined
    const second = mountRelease(
      {
        async release(input) {
          signal = input.signal
          return pending.promise
        }
      },
      () => context
    )
    const operation = second.release.release(PROJECT_REF, true)
    try {
      expect(first.release.reset()).toBe(false)
      expect(signal?.aborted).toBe(false)
      expect(second.release.state.value).toBe('loading')
      pending.finish(SUCCEEDED)
      await operation
      expect(second.release.result.value).toBe(SUCCEEDED)
    } finally {
      pending.finish(SUCCEEDED)
      await operation
      second.scope.stop()
    }
  })

  test.each(['dispose', 'configuration', 'review'] as const)(
    '%s cancels a newer un-dispatched operation without losing older dispatch evidence',
    async (change) => {
      const context = createContext('first')
      const pending = [deferredRelease(), deferredRelease()]
      const inputs: DesktopSupabaseBackendStagingReleaseInput[] = []
      const { scope, release, reviewed } = mountRelease(
        {
          async release(input) {
            inputs.push(input)
            return pending[inputs.length - 1].promise
          }
        },
        () => context
      )
      const first = release.release(PROJECT_REF, true)
      release.reset()
      const second = release.release(PROJECT_REF, true)
      try {
        markDispatched(inputs[0])
        if (change === 'configuration')
          context.config.value = { ...context.config.value, schema: 'private' }
        if (change === 'review')
          reviewed.value = {
            ...REVIEW,
            artifact: { ...REVIEW.artifact, manifestDigest: 'changed-review' }
          }
        if (change !== 'dispose') {
          expect(inputs[1].signal?.aborted).toBe(true)
          expect(release.state.value).toBe('loading')
        }
        pending[0].finish(UNKNOWN)
        await first
        if (change === 'dispose') scope.stop()
        expect(inputs[1].signal?.aborted).toBe(true)
        pending[1].finish(SUCCEEDED)
        await second
        expect(release.state.value).toBe('outcome-unknown')
        expect(release.result.value).toBe(UNKNOWN)
      } finally {
        scope.stop()
        pending[0].finish(UNKNOWN)
        pending[1].finish(SUCCEEDED)
        await Promise.all([first, second])
      }
    }
  )

  test('restores unknown outcomes across same-config sessions while an independent session succeeds', async () => {
    const first = createContext('first')
    const second = createContext('second')
    const current = shallowRef(first)
    const observed: string[] = []
    const { scope, release } = mountRelease(
      {
        async release(input) {
          observed.push(input.graph.rootId)
          markDispatched(input)
          return input.graph.rootId === 'first' ? UNKNOWN : SUCCEEDED
        }
      },
      () => current.value
    )
    try {
      await release.release(PROJECT_REF, true)
      current.value = second
      expect(release.state.value).toBe('idle')
      await release.release(PROJECT_REF, true)
      expect(release.result.value).toBe(SUCCEEDED)
      expect(release.reset()).toBe(true)
      expect(release.state.value).toBe('idle')
      current.value = first
      expect(release.state.value).toBe('outcome-unknown')
      expect(release.result.value).toBe(UNKNOWN)
      expect(release.reset()).toBe(false)
      await release.release(PROJECT_REF, true)
      expect(observed).toEqual(['first', 'second'])
    } finally {
      scope.stop()
    }
  })

  test('keeps dispatched completion and live graph readers bound to their original session', async () => {
    const first = createContext('first')
    const second = createContext('second')
    const current = shallowRef(first)
    const pending = deferredRelease()
    let firstInput: DesktopSupabaseBackendStagingReleaseInput | undefined
    const { scope, release } = mountRelease(
      {
        async release(input) {
          markDispatched(input)
          if (input.graph.rootId === 'first') {
            firstInput = input
            return pending.promise
          }
          return SUCCEEDED
        }
      },
      () => current.value
    )
    const operation = release.release(PROJECT_REF, true)
    try {
      current.value = second
      expect(firstInput?.signal?.aborted).toBe(false)
      first.graph.value = { ...GRAPH, rootId: 'first-replaced' }
      first.config.value = { ...first.config.value, schema: 'first-schema' }
      expect(firstInput?.graph.rootId).toBe('first-replaced')
      expect(firstInput?.readConfig?.()?.schema).toBe('first-schema')
      await release.release(PROJECT_REF, true)
      pending.finish(UNKNOWN)
      await operation
      expect(release.state.value).toBe('succeeded')
      expect(release.result.value).toBe(SUCCEEDED)
      current.value = first
      expect(release.state.value).toBe('outcome-unknown')
      expect(release.result.value).toBe(UNKNOWN)
    } finally {
      pending.finish(UNKNOWN)
      await operation
      scope.stop()
    }
  })

  test('cancels an un-dispatched session synchronously and ignores its late known result', async () => {
    const first = createContext('first')
    const second = createContext('second')
    const current = shallowRef(first)
    const pending = deferredRelease()
    let firstInput: DesktopSupabaseBackendStagingReleaseInput | undefined
    const { scope, release } = mountRelease(
      {
        async release(input) {
          if (input.graph.rootId === 'first') {
            firstInput = input
            return pending.promise
          }
          markDispatched(input)
          return SUCCEEDED
        }
      },
      () => current.value
    )
    const operation = release.release(PROJECT_REF, true)
    try {
      current.value = second
      expect(firstInput?.signal?.aborted).toBe(true)
      await release.release(PROJECT_REF, true)
      pending.finish(SUCCEEDED)
      await operation
      expect(release.result.value).toBe(SUCCEEDED)
      current.value = first
      expect(release.state.value).toBe('idle')
      expect(release.dispatched.value).toBe(false)
      expect(release.result.value).toBeNull()
    } finally {
      pending.finish(SUCCEEDED)
      await operation
      scope.stop()
    }
  })

  test('retains settled unknown receipts across inspector remounts without leaking scope services', async () => {
    const context = createContext('first')
    const first = mountRelease(
      {
        async release(input) {
          markDispatched(input)
          return UNKNOWN
        }
      },
      () => context
    )
    await first.release.release(PROJECT_REF, true)
    first.scope.stop()
    let secondCalls = 0
    const second = mountRelease(
      {
        async release() {
          secondCalls += 1
          return SUCCEEDED
        }
      },
      () => context
    )
    try {
      expect(second.release.result.value).toBe(UNKNOWN)
      expect(second.release.state.value).toBe('outcome-unknown')
      await second.release.release(PROJECT_REF, true)
      expect(secondCalls).toBe(0)
    } finally {
      second.scope.stop()
    }
  })

  test('a cancelled operation cannot remove its successor from scope cleanup', async () => {
    const context = createContext('first')
    const pending = [deferredRelease(), deferredRelease()]
    const inputs: DesktopSupabaseBackendStagingReleaseInput[] = []
    const { scope, release } = mountRelease(
      {
        async release(input) {
          inputs.push(input)
          return pending[inputs.length - 1].promise
        }
      },
      () => context
    )
    const first = release.release(PROJECT_REF, true)
    expect(release.reset()).toBe(true)
    const second = release.release(PROJECT_REF, true)
    try {
      pending[0].finish(SUCCEEDED)
      await first
      expect(release.state.value).toBe('loading')
      expect(release.result.value).toBeNull()
      scope.stop()
      expect(inputs[1].signal?.aborted).toBe(true)
    } finally {
      scope.stop()
      pending[0].finish(SUCCEEDED)
      pending[1].finish(SUCCEEDED)
      await Promise.all([first, second])
    }
  })

  test('scope disposal aborts the current un-dispatched session while another session settles', async () => {
    const first = createContext('first')
    const second = createContext('second')
    const current = shallowRef(first)
    const pending = [deferredRelease(), deferredRelease()]
    const inputs: DesktopSupabaseBackendStagingReleaseInput[] = []
    const mounted = mountRelease(
      {
        async release(input) {
          inputs.push(input)
          if (input.graph.rootId === 'first') markDispatched(input)
          return pending[inputs.length - 1].promise
        }
      },
      () => current.value
    )
    const firstRun = mounted.release.release(PROJECT_REF, true)
    current.value = second
    const secondRun = mounted.release.release(PROJECT_REF, true)
    mounted.scope.stop()
    expect(inputs[0].signal?.aborted).toBe(false)
    expect(inputs[1].signal?.aborted).toBe(true)
    pending[0].finish(UNKNOWN)
    pending[1].finish(SUCCEEDED)
    await Promise.all([firstRun, secondRun])
    const remounted = mountRelease({ release: async () => SUCCEEDED }, () => first)
    try {
      expect(remounted.release.state.value).toBe('outcome-unknown')
      expect(remounted.release.result.value).toBe(UNKNOWN)
    } finally {
      remounted.scope.stop()
    }
  })

  test('remounting after pre-dispatch disposal starts idle and uses the new scope service', async () => {
    const context = createContext('first')
    const pending = deferredRelease()
    let signal: AbortSignal | undefined
    const first = mountRelease(
      {
        async release(input) {
          signal = input.signal
          return pending.promise
        }
      },
      () => context
    )
    const firstRun = first.release.release(PROJECT_REF, true)
    first.scope.stop()
    expect(signal?.aborted).toBe(true)
    let calls = 0
    const second = mountRelease(
      {
        async release() {
          calls += 1
          return SUCCEEDED
        }
      },
      () => context
    )
    try {
      expect(second.release.state.value).toBe('idle')
      await second.release.release(PROJECT_REF, true)
      pending.finish(SUCCEEDED)
      await firstRun
      expect(calls).toBe(1)
      expect(second.release.result.value).toBe(SUCCEEDED)
    } finally {
      pending.finish(SUCCEEDED)
      await firstRun
      second.scope.stop()
    }
  })

  for (const outcome of ['returned', 'thrown'] as const) {
    test.each(['succeeded', 'error'] as const)(
      `keeps a late ${outcome} precommit unknown ahead of a newer %s outcome`,
      async (newerOutcome) => {
        const context = createContext('first')
        const pending = [deferredRelease(), deferredRelease()]
        const inputs: DesktopSupabaseBackendStagingReleaseInput[] = []
        const { scope, release, reviewed } = mountRelease(
          {
            async release(input) {
              const index = inputs.length
              inputs.push(input)
              const result = await pending[index].promise
              if (index === 0 && outcome === 'thrown') {
                throw new DesktopSupabaseBackendStagingReleaseError('outcome-unknown')
              }
              if (index === 1 && newerOutcome === 'error') {
                throw new DesktopSupabaseBackendStagingReleaseError('release-failed')
              }
              return result
            }
          },
          () => context
        )
        const first = release.release(PROJECT_REF, true)
        expect(release.reset()).toBe(true)
        reviewed.value = { ...REVIEW, projectRef: 'abcdefghijklmnopqrst', accountId: 'account-2' }
        const second = release.release(PROJECT_REF, true)
        try {
          markDispatched(inputs[0])
          pending[0].finish(UNKNOWN)
          await first
          expect(release.state.value).toBe('outcome-unknown')
          expect(release.dispatched.value).toBe(true)
          expect(release.target.value).toEqual({ projectRef: PROJECT_REF, accountId: 'account-1' })
          const unknownResult = release.result.value
          const unknownError = release.error.value
          pending[1].finish(SUCCEEDED)
          await second
          expect(release.state.value).toBe('outcome-unknown')
          expect(release.result.value).toBe(unknownResult)
          expect(release.error.value).toBe(unknownError)
          expect(release.target.value).toEqual({ projectRef: PROJECT_REF, accountId: 'account-1' })
        } finally {
          pending[0].finish(UNKNOWN)
          pending[1].finish(SUCCEEDED)
          await Promise.all([first, second])
          scope.stop()
        }
      }
    )
  }
})
