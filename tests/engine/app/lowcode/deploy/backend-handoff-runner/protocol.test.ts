import { afterEach, describe, expect, jest, mock, test } from 'bun:test'

import { BackendProviderDeployPreDispatchError } from '@/app/lowcode/preview-pane/deploy/backend-handoff-runner'

import {
  cleanupRunnerHarnesses,
  DEPLOY_RESULT,
  flushMicrotasks,
  NO_RUNNER_LISTENERS,
  runnerHarness
} from './helpers'

afterEach(() => {
  cleanupRunnerHarnesses()
  jest.useRealTimers()
})

describe('Backend Provider Host deploy handshake', () => {
  test.each(['digest', 'stage', 'malformed', 'oversized'] as const)(
    'rejects %s ready before revalidation or authorization',
    async (change) => {
      const revalidate = mock(() => undefined)
      const harness = await runnerHarness({ revalidate })
      if (change === 'malformed') harness.output('OPENPENCIL_BACKEND_READY {\n')
      else if (change === 'oversized') harness.output('x'.repeat(4097))
      else {
        harness.sendReady({
          ...harness.ready,
          ...(change === 'digest' ? { handoffDigest: 'E'.repeat(43) } : { stage: 'authorize' })
        })
      }
      expect(await harness.outcome).toMatchObject({
        ok: false,
        error: expect.any(BackendProviderDeployPreDispatchError)
      })
      expect(revalidate).not.toHaveBeenCalled()
      expect(harness.writes).toEqual([])
      expect(harness.kill).toHaveBeenCalledTimes(1)
      expect(harness.listeners()).toEqual(NO_RUNNER_LISTENERS)
    }
  )

  test('duplicate ready during fresh revalidation cancels once without authorizing', async () => {
    const validation = Promise.withResolvers<undefined>()
    const harness = await runnerHarness({ revalidate: () => validation.promise })
    harness.sendReady()
    await flushMicrotasks()
    harness.sendReady()
    harness.sendReady()
    await flushMicrotasks()
    expect(harness.writes).toEqual([{ ...harness.ready, stage: 'cancel' }])
    expect(harness.settled()).toBe(false)
    expect(harness.kill).not.toHaveBeenCalled()
    harness.close(1)
    expect(await harness.outcome).toMatchObject({
      ok: false,
      error: expect.any(BackendProviderDeployPreDispatchError)
    })
    validation.resolve(undefined)
    await flushMicrotasks()
    expect(harness.writes).toHaveLength(1)
    expect(harness.listeners()).toEqual(NO_RUNNER_LISTENERS)
  })

  test('abort while awaiting fresh authority sends cancel and preserves unrelated listeners', async () => {
    const validation = Promise.withResolvers<undefined>()
    const revalidate = mock(() => validation.promise)
    const harness = await runnerHarness({ revalidate })
    const foreignOutput = mock(() => undefined)
    harness.command.stdout.on('data', foreignOutput)
    harness.sendReady()
    await flushMicrotasks()
    expect(revalidate).toHaveBeenCalledTimes(1)
    harness.controller.abort()
    await flushMicrotasks()
    expect(harness.writes).toEqual([{ ...harness.ready, stage: 'cancel' }])
    expect(harness.settled()).toBe(false)
    harness.close(1)
    expect(await harness.outcome).toMatchObject({
      ok: false,
      error: expect.any(BackendProviderDeployPreDispatchError)
    })
    validation.resolve(undefined)
    await flushMicrotasks()
    expect(harness.writes).toHaveLength(1)
    expect(harness.kill).not.toHaveBeenCalled()
    expect(harness.listeners()).toEqual({ ...NO_RUNNER_LISTENERS, stdout: 1 })
    harness.output('after-close')
    expect(foreignOutput).toHaveBeenCalledTimes(2)
  })

  test('a failed authorize write remains an unknown outcome because bytes may have arrived', async () => {
    const transportError = new Error('Lost native write acknowledgement')
    const harness = await runnerHarness({
      onWrite(frame) {
        if (frame.stage === 'authorize') throw transportError
      }
    })
    harness.sendReady()
    expect(await harness.outcome).toEqual({ ok: false, error: transportError })
    expect(transportError).not.toBeInstanceOf(BackendProviderDeployPreDispatchError)
    expect(harness.writes).toEqual([{ ...harness.ready, stage: 'authorize' }])
    expect(harness.kill).toHaveBeenCalledTimes(1)
    expect(harness.listeners()).toEqual(NO_RUNNER_LISTENERS)
  })

  test.each(['resolve', 'reject'] as const)(
    'native close before authorize acknowledgement must await its eventual %s',
    async (completion) => {
      const acknowledgement = Promise.withResolvers<undefined>()
      const harness = await runnerHarness({ onWrite: () => acknowledgement.promise })
      harness.sendReady()
      await flushMicrotasks()
      expect(harness.writes).toEqual([{ ...harness.ready, stage: 'authorize' }])
      harness.output(JSON.stringify(DEPLOY_RESULT))
      harness.close()
      await flushMicrotasks()
      expect(harness.settled()).toBe(false)
      const error = new Error('Native stdin acknowledgement lost after close')
      if (completion === 'resolve') acknowledgement.resolve(undefined)
      else acknowledgement.reject(error)
      expect(await harness.outcome).toEqual(
        completion === 'resolve'
          ? { ok: true, value: { ...DEPLOY_RESULT, serverDeployment: undefined } }
          : { ok: false, error }
      )
      expect(harness.kill).not.toHaveBeenCalled()
      expect(harness.listeners()).toEqual(NO_RUNNER_LISTENERS)
    }
  )

  test('exit zero plus plausible JSON cannot bypass ready and authorization', async () => {
    const harness = await runnerHarness()
    harness.output(JSON.stringify(DEPLOY_RESULT))
    harness.close()
    expect(await harness.outcome).toMatchObject({
      ok: false,
      error: expect.any(BackendProviderDeployPreDispatchError)
    })
    expect(harness.writes).toEqual([])
    expect(harness.listeners()).toEqual(NO_RUNNER_LISTENERS)
  })

  test('unresponsive cancellation receives only bounded grace before killing the owned child', async () => {
    jest.useFakeTimers()
    const refusal = new Error('Reviewed authority changed')
    const harness = await runnerHarness({
      revalidate() {
        throw refusal
      }
    })
    harness.sendReady()
    await flushMicrotasks()
    expect(harness.writes).toEqual([{ ...harness.ready, stage: 'cancel' }])
    expect(harness.kill).not.toHaveBeenCalled()
    jest.advanceTimersByTime(2999)
    expect(harness.settled()).toBe(false)
    jest.advanceTimersByTime(1)
    expect(await harness.outcome).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        name: 'BackendProviderDeployPreDispatchError',
        cause: refusal
      })
    })
    expect(harness.kill).toHaveBeenCalledTimes(1)
    expect(harness.listeners()).toEqual(NO_RUNNER_LISTENERS)
    jest.advanceTimersByTime(120_000)
    expect(harness.kill).toHaveBeenCalledTimes(1)
  })
})
