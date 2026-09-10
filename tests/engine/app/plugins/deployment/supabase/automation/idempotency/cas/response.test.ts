import { describe, expect, test } from 'bun:test'

import {
  BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
  createBackendAutomationIdempotencyCASProposal,
  type BackendAutomationIdempotencyRecordV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESPONSE_OBSERVATION_FORMAT,
  SupabaseAutomationIdempotencyCASResponseError,
  parseSupabaseAutomationIdempotencyCASResponseForTestingV1,
  trustedSupabaseAutomationIdempotencyCASResponseObservationContextV1,
  type SupabaseAutomationIdempotencyCASResponseErrorCode
} from '@/app/plugins/host/deployment/supabase/automation/idempotency/cas/response'
import {
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES,
  createSupabaseAutomationIdempotencyCASReviewForTestingV1,
  trustedSupabaseAutomationIdempotencyCASReviewContextV1,
  type SupabaseAutomationIdempotencyCASReviewEnvelopeV1
} from '@/app/plugins/host/deployment/supabase/automation/idempotency/cas/review'

const APPLICATION_OBJECT_KEY = 'abcde12345abcde12345'
const CREATED_AT = '2026-09-09T00:00:00.000Z'
const EXPIRES_AT = '2026-09-10T00:00:00.000Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function createReview(): Promise<SupabaseAutomationIdempotencyCASReviewEnvelopeV1> {
  const record: BackendAutomationIdempotencyRecordV1 = {
    format: BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
    version: 1,
    automationId: 'automation-send-receipt',
    eventId: 'event-001',
    operationId: 'operation-001',
    idempotencyKeyDigest: await digest('idempotency-key'),
    causationId: 'causation-001',
    causationHop: 0,
    retentionHours: 24,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    recordedAt: CREATED_AT,
    revision: 0,
    previousRecordDigest: null,
    attemptIds: ['attempt-001'],
    currentAttemptId: 'attempt-001',
    state: 'reserved',
    completionEvidenceDigest: null,
    knownNotDispatchedEvidenceDigest: null,
    reconciliationEvidenceDigest: null,
    hostEvidenceAuthenticated: false,
    persistenceAuthorityGranted: false,
    dispatchAuthorityGranted: false
  }
  return createSupabaseAutomationIdempotencyCASReviewForTestingV1({
    applicationObjectKey: APPLICATION_OBJECT_KEY,
    candidate: await createBackendAutomationIdempotencyCASProposal(null, record),
    currentRecord: null
  })
}

async function expectResponseError(
  operation: Promise<unknown>,
  expected: SupabaseAutomationIdempotencyCASResponseErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseAutomationIdempotencyCASResponseError)
    expect((cause as SupabaseAutomationIdempotencyCASResponseError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected CAS response error ${expected}.`)
}

describe('Supabase Backend Automation idempotency CAS response', () => {
  test('accepts only the six fixed statuses and returns authority-free bound observations', async () => {
    const casReview = await createReview()
    const reviewContext = trustedSupabaseAutomationIdempotencyCASReviewContextV1(casReview)
    if (!reviewContext) throw new TypeError('Expected a trusted CAS review context.')

    for (const status of SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES) {
      const observation = await parseSupabaseAutomationIdempotencyCASResponseForTestingV1({
        casReview,
        response: [{ status }]
      })
      expect(observation).toMatchObject({
        format: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESPONSE_OBSERVATION_FORMAT,
        version: 1,
        providerId: 'supabase',
        environment: 'staging',
        testingOnly: true,
        status,
        bindings: {
          reviewDigest: casReview.reviewDigest,
          renderedSqlDigest: casReview.review.bindings.renderedSqlDigest,
          parameterSchemaDigest: casReview.review.bindings.parameterSchemaDigest,
          parameterValuesDigest: casReview.review.bindings.parameterValuesDigest,
          resultDigest: await digestCanonicalManifest([{ status }])
        },
        reportedStatusProvesDatabaseState: false,
        reportedStatusProvesCommit: false,
        reportedStatusAuthenticated: false,
        requiresReadOnlyReconciliation: true,
        databaseCASCommitted: false,
        automaticRetryAllowed: false,
        captureConsumed: false,
        hiddenParameterValuesExposed: false,
        operationAuthorityAuthenticated: false,
        hostEvidenceAuthenticated: false,
        credentialAuthorityCreated: false,
        transportAuthorityCreated: false,
        databaseAuthorityCreated: false,
        mutationAuthorityCreated: false,
        executionAuthorityCreated: false,
        receiptAuthorityCreated: false,
        releaseAuthorityCreated: false,
        persistenceAuthorityGranted: false,
        dispatchAuthorityGranted: false,
        releaseReady: false
      })
      expect(Object.isFrozen(observation)).toBe(true)
      expect(Object.isFrozen(observation.bindings)).toBe(true)

      const context =
        trustedSupabaseAutomationIdempotencyCASResponseObservationContextV1(observation)
      expect(context?.observation).toBe(observation)
      expect(context?.reviewContext).toBe(reviewContext)
      expect(context?.canonicalResult).toEqual([{ status }])
      expect(Object.isFrozen(context)).toBe(true)
      expect(Object.isFrozen(context?.canonicalResult)).toBe(true)
      expect(Object.isFrozen(context?.canonicalResult[0])).toBe(true)
      expect(
        trustedSupabaseAutomationIdempotencyCASResponseObservationContextV1(
          structuredClone(observation)
        )
      ).toBeNull()
      expect(
        trustedSupabaseAutomationIdempotencyCASResponseObservationContextV1({ ...observation })
      ).toBeNull()
    }

    const publicObservation = JSON.stringify(
      await parseSupabaseAutomationIdempotencyCASResponseForTestingV1({
        casReview,
        response: [{ status: 'inserted' }]
      })
    )
    expect(publicObservation).not.toContain('automation-send-receipt')
    expect(publicObservation).not.toContain(String(reviewContext.parameters[1]))
    expect(publicObservation).not.toContain(String(reviewContext.parameters[3]))
  })

  test('snapshots exact input and result before the first await', async () => {
    const casReview = await createReview()
    const responseRow = { status: 'inserted' }
    const response = [responseRow]
    const input = { casReview, response }
    const pending = parseSupabaseAutomationIdempotencyCASResponseForTestingV1(input)

    responseRow.status = 'corruption'
    response.push({ status: 'cas-conflict' })
    input.response = [{ status: 'precondition-failed' }]

    const observation = await pending
    expect(observation.status).toBe('inserted')
    expect(observation.bindings.resultDigest).toBe(
      await digestCanonicalManifest([{ status: 'inserted' }])
    )
    expect(
      trustedSupabaseAutomationIdempotencyCASResponseObservationContextV1(observation)
        ?.canonicalResult
    ).toEqual([{ status: 'inserted' }])
  })

  test('rejects accessors without invoking them and rejects transparent proxies', async () => {
    const casReview = await createReview()
    let inputGetterCalls = 0
    const accessorInput = { casReview, response: null as unknown }
    Object.defineProperty(accessorInput, 'response', {
      enumerable: true,
      get() {
        inputGetterCalls += 1
        return [{ status: 'inserted' }]
      }
    })
    await expectResponseError(
      parseSupabaseAutomationIdempotencyCASResponseForTestingV1(accessorInput),
      'supabase-automation-idempotency-cas-response-input-invalid'
    )
    expect(inputGetterCalls).toBe(0)

    let rowGetterCalls = 0
    const accessorRow = {}
    Object.defineProperty(accessorRow, 'status', {
      enumerable: true,
      get() {
        rowGetterCalls += 1
        return 'inserted'
      }
    })
    await expectResponseError(
      parseSupabaseAutomationIdempotencyCASResponseForTestingV1({
        casReview,
        response: [accessorRow]
      }),
      'supabase-automation-idempotency-cas-response-invalid'
    )
    expect(rowGetterCalls).toBe(0)

    await expectResponseError(
      parseSupabaseAutomationIdempotencyCASResponseForTestingV1(
        new Proxy({ casReview, response: [{ status: 'inserted' }] }, {})
      ),
      'supabase-automation-idempotency-cas-response-input-invalid'
    )
    await expectResponseError(
      parseSupabaseAutomationIdempotencyCASResponseForTestingV1({
        casReview,
        response: new Proxy([{ status: 'inserted' }], {})
      }),
      'supabase-automation-idempotency-cas-response-invalid'
    )
    await expectResponseError(
      parseSupabaseAutomationIdempotencyCASResponseForTestingV1({
        casReview,
        response: [new Proxy({ status: 'inserted' }, {})]
      }),
      'supabase-automation-idempotency-cas-response-invalid'
    )
  })

  test('rejects copied reviews and non-exact input records', async () => {
    const casReview = await createReview()
    for (const forgedReview of [structuredClone(casReview), { ...casReview }]) {
      await expectResponseError(
        parseSupabaseAutomationIdempotencyCASResponseForTestingV1({
          casReview: forgedReview,
          response: [{ status: 'inserted' }]
        }),
        'supabase-automation-idempotency-cas-response-proof-invalid'
      )
    }

    await expectResponseError(
      parseSupabaseAutomationIdempotencyCASResponseForTestingV1({
        casReview,
        response: [{ status: 'inserted' }],
        extra: true
      } as never),
      'supabase-automation-idempotency-cas-response-input-invalid'
    )
    const symbolInput = { casReview, response: [{ status: 'inserted' }] }
    Reflect.set(symbolInput, Symbol('extra'), true)
    await expectResponseError(
      parseSupabaseAutomationIdempotencyCASResponseForTestingV1(symbolInput),
      'supabase-automation-idempotency-cas-response-input-invalid'
    )
  })

  test('rejects every non-native, non-singleton, or non-exact result shape', async () => {
    const casReview = await createReview()
    class ResultArray extends Array<unknown> {}
    const sparse: unknown[] = []
    sparse.length = 1
    const extraArrayProperty = [{ status: 'inserted' }]
    Reflect.set(extraArrayProperty, 'extra', true)
    const symbolArrayProperty = [{ status: 'inserted' }]
    Reflect.set(symbolArrayProperty, Symbol('extra'), true)
    const nullPrototypeArray = [{ status: 'inserted' }]
    Object.setPrototypeOf(nullPrototypeArray, null)
    const symbolRow = { status: 'inserted' }
    Reflect.set(symbolRow, Symbol('extra'), true)

    const invalidResponses: unknown[] = [
      null,
      { 0: { status: 'inserted' }, length: 1 },
      [],
      sparse,
      [{ status: 'inserted' }, { status: 'inserted' }],
      extraArrayProperty,
      symbolArrayProperty,
      nullPrototypeArray,
      new ResultArray({ status: 'inserted' }),
      [null],
      [[]],
      [{ status: 'inserted', extra: true }],
      [symbolRow],
      [{ status: 'INSERTED' }],
      [{ status: 'committed' }],
      [{ status: Object.freeze({ value: 'inserted' }) }]
    ]

    for (const response of invalidResponses) {
      await expectResponseError(
        parseSupabaseAutomationIdempotencyCASResponseForTestingV1({ casReview, response }),
        'supabase-automation-idempotency-cas-response-invalid'
      )
    }
  })
})
