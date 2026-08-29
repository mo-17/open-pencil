import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  MARKETPLACE_NONCE_NAMESPACES,
  MarketplacePublisherMutationCommitPlan,
  MarketplacePublisherMutationConflictError,
  MarketplacePublisherMutationTerminalError,
  createMarketplacePublisherMutationResponse,
  createMarketplacePublisherMutationTerminalResponse,
  createMemoryMarketplaceRepository,
  type MarketplaceVerifiedPublisherMutationRequest
} from '@open-pencil/marketplace'

const NOW = Date.parse('2026-08-27T12:00:00.000Z')

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function request(
  overrides: Partial<MarketplaceVerifiedPublisherMutationRequest> = {}
): MarketplaceVerifiedPublisherMutationRequest {
  return {
    authVersion: 2,
    operation: 'publisher.register',
    audience: 'openpencil-marketplace',
    publisherId: 'atomic-publisher',
    keyId: 'atomic-publisher-2026',
    method: 'POST',
    target: '/v1/publishers/register',
    timestamp: '2026-08-27T12:00:00.000Z',
    nonce: 'atomicnonce00001',
    bodyDigest: digest('body'),
    requestDigest: digest('request'),
    signatureDigest: digest('signature'),
    freshUntil: NOW + 300_000,
    ...overrides
  }
}

async function syntheticSuccessResponse() {
  const fixture = createMemoryMarketplaceRepository({ now: () => NOW })
  const publisher = await fixture.transaction((transaction) =>
    transaction.createPublisher(
      { id: 'synthetic-success', displayName: 'Synthetic Success' },
      { actor: 'admin:test', time: '2026-08-27T12:00:00.000Z' }
    )
  )
  return createMarketplacePublisherMutationResponse('publisher.register', publisher)
}

describe('Marketplace Publisher mutation memory idempotency', () => {
  test('commits one state effect and replays one exact result to concurrent callers', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    let executions = 0
    const execute = () =>
      repository.executePublisherMutation(request(), NOW, async (transaction) => {
        executions++
        const publisher = await transaction.createPublisher(
          { id: 'atomic-publisher', displayName: 'Atomic Publisher' },
          { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return createMarketplacePublisherMutationResponse('publisher.register', publisher)
      })

    const [first, second] = await Promise.all([execute(), execute()])
    expect(executions).toBe(1)
    expect([first.source, second.source].sort()).toEqual(['committed', 'replayed'])
    expect(second.response).toEqual(first.response)
    const state = await repository.snapshot()
    expect(state.publishers).toHaveLength(1)
    expect(state.auditEvents).toHaveLength(1)
  })

  test('rejects a nonce collision without leaking or replacing the committed result', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    await repository.executePublisherMutation(request(), NOW, async (transaction) => {
      const publisher = await transaction.createPublisher(
        { id: 'atomic-publisher', displayName: 'Atomic Publisher' },
        { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
      )
      return createMarketplacePublisherMutationResponse('publisher.register', publisher)
    })

    await expect(
      repository.inspectPublisherMutation(request({ bodyDigest: digest('different body') }), NOW)
    ).rejects.toBeInstanceOf(MarketplacePublisherMutationConflictError)
    expect((await repository.snapshot()).publishers).toHaveLength(1)
  })

  test('keeps Publisher and Operator nonce namespaces independent', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    const nonce = 'sharednonce00001'
    expect(
      await repository.nonces.consume(
        MARKETPLACE_NONCE_NAMESPACES.operatorAssertionV2,
        'openpencil-marketplace-admin',
        nonce,
        NOW + 60_000
      )
    ).toBe(true)
    expect(
      await repository.nonces.consume(
        MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
        'admin-assertion-v2',
        nonce,
        NOW + 60_000
      )
    ).toBe(true)
  })

  test('rolls back state and leaves the exact request retryable after an internal failure', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    await expect(
      repository.executePublisherMutation(request(), NOW, async (transaction) => {
        await transaction.createPublisher(
          { id: 'atomic-publisher', displayName: 'Atomic Publisher' },
          { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        throw new Error('injected failure before commit')
      })
    ).rejects.toThrow('injected failure')
    expect((await repository.snapshot()).publishers).toHaveLength(0)

    const retried = await repository.executePublisherMutation(
      request(),
      NOW,
      async (transaction) => {
        const publisher = await transaction.createPublisher(
          { id: 'atomic-publisher', displayName: 'Atomic Publisher' },
          { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return createMarketplacePublisherMutationResponse('publisher.register', publisher)
      }
    )
    expect(retried.source).toBe('committed')
  })

  test('rejects normally returned terminal responses and terminal commit plans without side effects', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    const returnedRequest = request({
      nonce: 'returnedterminal01',
      requestDigest: digest('returned terminal request'),
      signatureDigest: digest('returned terminal signature')
    })
    await expect(
      repository.executePublisherMutation(returnedRequest, NOW, async (transaction) => {
        await transaction.createPublisher(
          { id: 'atomic-publisher', displayName: 'Must Roll Back' },
          { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return createMarketplacePublisherMutationTerminalResponse(
          new MarketplacePublisherMutationTerminalError('state-conflict')
        ) as never
      })
    ).rejects.toThrow('Publisher mutation callback must return a success response')
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    expect((await repository.snapshot()).auditEvents).toHaveLength(0)
    expect(await repository.inspectPublisherMutation(returnedRequest, NOW)).toBeNull()

    let commitSideEffects = 0
    const plannedRequest = request({
      nonce: 'plannedterminal001',
      requestDigest: digest('planned terminal request'),
      signatureDigest: digest('planned terminal signature')
    })
    await expect(
      repository.executePublisherMutation(plannedRequest, NOW, async (transaction) => {
        await transaction.createPublisher(
          { id: 'atomic-publisher', displayName: 'Must Still Roll Back' },
          { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return new MarketplacePublisherMutationCommitPlan(
          'publisher.register',
          createMarketplacePublisherMutationTerminalResponse(
            new MarketplacePublisherMutationTerminalError('state-conflict')
          ) as never,
          async () => {
            commitSideEffects++
          }
        )
      })
    ).rejects.toThrow('Publisher mutation callback must return a success response')
    expect(commitSideEffects).toBe(0)
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    expect((await repository.snapshot()).auditEvents).toHaveLength(0)
    expect(await repository.inspectPublisherMutation(plannedRequest, NOW)).toBeNull()

    const successResponse = await syntheticSuccessResponse()
    let poisonedPlanSideEffects = 0
    const poisonedRequest = request({
      nonce: 'poisonedplan0001',
      requestDigest: digest('poisoned plan request'),
      signatureDigest: digest('poisoned plan signature')
    })
    await expect(
      repository.executePublisherMutation(poisonedRequest, NOW, async (transaction) => {
        try {
          await transaction.createPublisher(
            { id: 'invalid publisher id', displayName: 'Invalid Publisher' },
            { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
          )
        } catch (error) {
          // A callback may catch its immediate mutation rejection, but the
          // transaction remains poisoned and must close before any side effect.
          expect(error).toBeInstanceOf(Error)
        }
        return new MarketplacePublisherMutationCommitPlan(
          'publisher.register',
          successResponse,
          async () => {
            poisonedPlanSideEffects++
          }
        )
      })
    ).rejects.toThrow()
    expect(poisonedPlanSideEffects).toBe(0)
    expect(await repository.inspectPublisherMutation(poisonedRequest, NOW)).toBeNull()

    let failingPlanAttempts = 0
    const failingPlanRequest = request({
      nonce: 'failingplan00001',
      requestDigest: digest('failing plan request'),
      signatureDigest: digest('failing plan signature')
    })
    await expect(
      repository.executePublisherMutation(
        failingPlanRequest,
        NOW,
        async () =>
          new MarketplacePublisherMutationCommitPlan(
            'publisher.register',
            successResponse,
            async () => {
              failingPlanAttempts++
              throw new MarketplacePublisherMutationTerminalError('state-conflict')
            }
          )
      )
    ).rejects.toBeInstanceOf(MarketplacePublisherMutationTerminalError)
    expect(failingPlanAttempts).toBe(1)
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    expect((await repository.snapshot()).auditEvents).toHaveLength(0)
    expect(await repository.inspectPublisherMutation(failingPlanRequest, NOW)).toBeNull()
  })

  test('atomically commits an exact deterministic failure while rolling back domain state', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    const typedFailure = new MarketplacePublisherMutationTerminalError('state-conflict')
    typedFailure.message = 'must never be persisted'
    const committed = await repository.executePublisherMutation(
      request(),
      NOW,
      async (transaction) => {
        await transaction.createPublisher(
          { id: 'atomic-publisher', displayName: 'Must Roll Back' },
          { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        throw typedFailure
      }
    )
    expect(committed.source).toBe('committed')
    expect(committed.response.status).toBe(409)
    expect(JSON.parse(committed.response.json)).toEqual({
      error: 'Marketplace Publisher mutation conflicts with current state'
    })
    expect((await repository.snapshot()).publishers).toHaveLength(0)
    expect((await repository.snapshot()).auditEvents).toHaveLength(0)
    await expect(
      repository.inspectPublisherMutation(
        request({ signatureDigest: digest('different signature') }),
        NOW
      )
    ).rejects.toBeInstanceOf(MarketplacePublisherMutationConflictError)

    await repository.transaction((transaction) =>
      transaction.createPublisher(
        { id: 'state-changed', displayName: 'State Changed' },
        { actor: 'admin:test', time: '2026-08-27T12:00:00.000Z' }
      )
    )
    let replayCallbackCalls = 0
    const replayed = await repository.executePublisherMutation(
      request(),
      NOW,
      async (transaction) => {
        replayCallbackCalls++
        const publisher = await transaction.createPublisher(
          { id: 'atomic-publisher', displayName: 'Would Succeed' },
          { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return createMarketplacePublisherMutationResponse('publisher.register', publisher)
      }
    )
    expect(replayCallbackCalls).toBe(0)
    expect(replayed.source).toBe('replayed')
    expect(replayed.response).toEqual(committed.response)
    expect((await repository.snapshot()).publishers.map(({ id }) => id)).toEqual(['state-changed'])
  })

  test('round-trips every supported deterministic terminal status as an exact receipt', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    const cases = [
      ['invalid-request', 400],
      ['authority-inactive', 401],
      ['resource-not-found', 404],
      ['state-conflict', 409]
    ] as const

    for (const [index, [code, status]] of cases.entries()) {
      const exactRequest = request({
        nonce: `terminalnonce000${index}`,
        requestDigest: digest(`terminal request ${index}`),
        signatureDigest: digest(`terminal signature ${index}`)
      })
      const committed = await repository.executePublisherMutation(exactRequest, NOW, async () => {
        throw new MarketplacePublisherMutationTerminalError(code)
      })
      const replayed = await repository.executePublisherMutation(exactRequest, NOW, async () => {
        throw new Error('a terminal receipt must bypass the callback')
      })
      expect(committed.response.status).toBe(status)
      expect(replayed.source).toBe('replayed')
      expect(replayed.response).toEqual(committed.response)
    }
  })

  test('uses server time so a future-skew request cannot evict another live receipt', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    const earlier = request({
      timestamp: '2026-08-27T11:56:00.000Z',
      freshUntil: NOW + 60_000
    })
    const committed = await repository.executePublisherMutation(
      earlier,
      NOW,
      async (transaction) => {
        const publisher = await transaction.createPublisher(
          { id: 'atomic-publisher', displayName: 'Atomic Publisher' },
          { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
        )
        return createMarketplacePublisherMutationResponse('publisher.register', publisher)
      }
    )
    const futureSkew = request({
      publisherId: 'future-publisher',
      keyId: 'future-publisher-2026',
      nonce: 'futureskewnonce01',
      timestamp: '2026-08-27T12:04:00.000Z',
      freshUntil: NOW + 540_000,
      requestDigest: digest('future request'),
      signatureDigest: digest('future signature')
    })

    expect(await repository.inspectPublisherMutation(futureSkew, NOW)).toBeNull()
    const replayed = await repository.inspectPublisherMutation(earlier, earlier.freshUntil)
    expect(replayed?.source).toBe('replayed')
    expect(replayed?.response).toEqual(committed.response)
    expect(await repository.inspectPublisherMutation(earlier, earlier.freshUntil + 1)).toBeNull()
  })

  test('keeps a nonce collision bound through the later signed request freshness window', async () => {
    const repository = createMemoryMarketplaceRepository({ now: () => NOW })
    const original = request()
    await repository.executePublisherMutation(original, NOW, async (transaction) => {
      const publisher = await transaction.createPublisher(
        { id: 'atomic-publisher', displayName: 'Atomic Publisher' },
        { actor: 'publisher:atomic-publisher', time: '2026-08-27T12:00:00.000Z' }
      )
      return createMarketplacePublisherMutationResponse('publisher.register', publisher)
    })
    const collision = request({
      timestamp: '2026-08-27T12:04:00.000Z',
      freshUntil: NOW + 9 * 60_000,
      bodyDigest: digest('later collision body'),
      requestDigest: digest('later collision request'),
      signatureDigest: digest('later collision signature')
    })
    const response = await syntheticSuccessResponse()
    let callbackCount = 0
    const executeCollision = () =>
      repository.executePublisherMutation(collision, NOW + 5 * 60_000 + 1, async () => {
        callbackCount++
        return response
      })

    await expect(
      repository.executePublisherMutation(collision, NOW + 4 * 60_000, async () => {
        callbackCount++
        return response
      })
    ).rejects.toBeInstanceOf(MarketplacePublisherMutationConflictError)
    await expect(executeCollision()).rejects.toBeInstanceOf(
      MarketplacePublisherMutationConflictError
    )
    expect(callbackCount).toBe(0)
    expect(
      await repository.inspectPublisherMutation(collision, collision.freshUntil + 1)
    ).toBeNull()
  })
})
