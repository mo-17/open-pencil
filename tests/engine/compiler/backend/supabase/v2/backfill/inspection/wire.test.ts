/* oxlint-disable open-pencil/no-broad-double-cast, open-pencil/no-broad-unknown-type-assertions -- Wire adversarial tests intentionally traverse and mutate parsed untrusted JSON. */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  createSupabaseBackfillCompilerBuildAuthorityV1,
  createSupabaseBackfillCompilerSelectionV1,
  createSupabaseBackfillInspectionSubjectV1,
  createSupabaseBackfillInspectionWireResponseV1,
  parseSupabaseBackfillInspectionWireRequestV1,
  parseSupabaseBackfillInspectionWireResponseV1,
  serializeSupabaseBackfillInspectionWireRequestV1,
  serializeSupabaseBackfillInspectionWireResponseV1,
  supabaseBackfillInspectionWireRequestDigestV1,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  SUPABASE_BACKFILL_COMPILER_TRUST_DOMAIN_DIGEST_V1,
  SUPABASE_BACKFILL_COMPILER_TRUST_SELECTION_DIGEST_V1,
  SUPABASE_BACKFILL_INSPECTION_WIRE_LIMITS_V1,
  SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1,
  type ParsedSupabaseBackfillInspectionWireRequestV1,
  type SupabaseBackfillInspectionWireRequestV1
} from '@open-pencil/compiler'

import { supabaseBackfillApplicationV2 } from '#tests/engine/compiler/backend/supabase/v2/helpers'

type JSONData = boolean | null | number | string | JSONData[] | { [key: string]: JSONData }

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function compareKeys(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function canonical(value: JSONData): JSONData {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareKeys(left, right))
      .map(([key, entry]) => [key, canonical(entry)])
  )
}

function canonicalFrame(value: unknown): string {
  return JSON.stringify(canonical(value as JSONData))
}

function reversed(value: JSONData): JSONData {
  if (Array.isArray(value)) return value.map(reversed)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reversed(entry)])
  )
}

function request(
  requestNonce = digest('openpencil:test:backfill-inspection:nonce:one'),
  target: 'react' | 'vue' = 'react'
): SupabaseBackfillInspectionWireRequestV1 {
  return {
    version: SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1,
    requestNonce,
    target,
    application: supabaseBackfillApplicationV2()
  }
}

function subjectFor(requestValue: SupabaseBackfillInspectionWireRequestV1) {
  const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
  const selection = createSupabaseBackfillCompilerSelectionV1()
  const planned = createBackendProviderPlanV2(registry, {
    selection,
    application: requestValue.application,
    target: requestValue.target,
    mode: 'production'
  })
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  return createSupabaseBackfillInspectionSubjectV1(registry, {
    plan: planned.plan,
    selection
  })
}

function completeExchange(): {
  readonly parsedRequest: ParsedSupabaseBackfillInspectionWireRequestV1
  readonly serializedResponse: string
} {
  const requestValue = request()
  const parsedRequest = parseSupabaseBackfillInspectionWireRequestV1(
    serializeSupabaseBackfillInspectionWireRequestV1(requestValue)
  )
  const serializedResponse = serializeSupabaseBackfillInspectionWireResponseV1({
    request: parsedRequest.request,
    requestDigest: parsedRequest.requestDigest,
    subjectEnvelope: subjectFor(parsedRequest.request)
  })
  return { parsedRequest, serializedResponse }
}

describe('Supabase backfill Compiler inspection wire', () => {
  test('accepts only the exact canonical four-field request and rejects derived authority', () => {
    const requestValue = request()
    const serialized = serializeSupabaseBackfillInspectionWireRequestV1(requestValue)
    const parsed = parseSupabaseBackfillInspectionWireRequestV1(serialized)

    expect(parsed.request).toEqual(requestValue)
    expect(serialized).toBe(canonicalFrame(requestValue))
    expect(() => parseSupabaseBackfillInspectionWireRequestV1(`${serialized}\n`)).toThrow(
      'exact canonical JSON encoding'
    )
    expect(() =>
      parseSupabaseBackfillInspectionWireRequestV1(
        'x'.repeat(SUPABASE_BACKFILL_INSPECTION_WIRE_LIMITS_V1.maxRequestBytes + 1)
      )
    ).toThrow('byte limit')

    for (const extra of ['plan', 'selection', 'mode', 'packageDigest', 'envelope']) {
      const malicious = { ...(JSON.parse(serialized) as Record<string, unknown>), [extra]: {} }
      expect(() => parseSupabaseBackfillInspectionWireRequestV1(canonicalFrame(malicious))).toThrow(
        'exact protocol fields'
      )
      expect(() => serializeSupabaseBackfillInspectionWireRequestV1(malicious as never)).toThrow(
        'exact protocol fields'
      )
    }
  })

  test('pins a nonce-independent domain digest and canonicalizes recursive insertion order', () => {
    const first = request()
    const second = request(digest('openpencil:test:backfill-inspection:nonce:two'))
    const reversedRequest = reversed(
      first as unknown as JSONData
    ) as SupabaseBackfillInspectionWireRequestV1

    expect(first.requestNonce).not.toBe(second.requestNonce)
    expect(supabaseBackfillInspectionWireRequestDigestV1(first)).toBe(
      supabaseBackfillInspectionWireRequestDigestV1(second)
    )
    expect(serializeSupabaseBackfillInspectionWireRequestV1(reversedRequest)).toBe(
      serializeSupabaseBackfillInspectionWireRequestV1(first)
    )
    expect(supabaseBackfillInspectionWireRequestDigestV1(first)).toMatch(
      /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
    )
    expect(supabaseBackfillInspectionWireRequestDigestV1(first)).toBe(
      '91DZa4z_47vpixRre3luixKLVdNNmpMgjIaTUo5-frQ'
    )
    expect(SUPABASE_BACKFILL_COMPILER_TRUST_DOMAIN_DIGEST_V1).toMatch(
      /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
    )
    expect(SUPABASE_BACKFILL_COMPILER_TRUST_DOMAIN_DIGEST_V1).toBe(
      'oDpvqWPIvv_9Xs47gJBTH2NwOYb8hFvuCii2nrUe7fw'
    )
    expect(SUPABASE_BACKFILL_COMPILER_TRUST_SELECTION_DIGEST_V1).toBe(
      `sha256:${SUPABASE_BACKFILL_COMPILER_TRUST_DOMAIN_DIGEST_V1}`
    )
    expect(SUPABASE_BACKFILL_COMPILER_TRUST_SELECTION_DIGEST_V1).not.toContain(
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    )
  })

  test('rejects unpaired UTF-16 surrogates before they can cross the native boundary', () => {
    for (const invalid of ['\ud800', '\ud800A', '\udc00']) {
      const malformed = structuredClone(request())
      const migration = malformed.application.dataMigrations.migrations[0]
      migration.name = invalid
      const frame = canonicalFrame(malformed)

      expect(() => serializeSupabaseBackfillInspectionWireRequestV1(malformed)).toThrow(
        'well-formed Unicode strings'
      )
      expect(() => parseSupabaseBackfillInspectionWireRequestV1(frame)).toThrow(
        'well-formed Unicode strings'
      )
    }

    const valid = structuredClone(request())
    const migration = valid.application.dataMigrations.migrations[0]
    migration.name = 'Backfill 😀 status'
    expect(() => serializeSupabaseBackfillInspectionWireRequestV1(valid)).not.toThrow()
  })

  test('changes the request digest on target or application tamper and binds responses to both', () => {
    const original = request()
    const targetTamper = request(original.requestNonce, 'vue')
    const applicationTamper = structuredClone(original)
    applicationTamper.application.applicationId = 'test.supabase-foreign-backfill'

    const originalDigest = supabaseBackfillInspectionWireRequestDigestV1(original)
    expect(supabaseBackfillInspectionWireRequestDigestV1(targetTamper)).not.toBe(originalDigest)
    expect(supabaseBackfillInspectionWireRequestDigestV1(applicationTamper)).not.toBe(
      originalDigest
    )

    const { parsedRequest, serializedResponse } = completeExchange()
    const parsedTargetTamper = parseSupabaseBackfillInspectionWireRequestV1(
      serializeSupabaseBackfillInspectionWireRequestV1(targetTamper)
    )
    const parsedApplicationTamper = parseSupabaseBackfillInspectionWireRequestV1(
      serializeSupabaseBackfillInspectionWireRequestV1(applicationTamper)
    )
    expect(() =>
      parseSupabaseBackfillInspectionWireResponseV1(serializedResponse, parsedTargetTamper)
    ).toThrow('request binding')
    expect(() =>
      parseSupabaseBackfillInspectionWireResponseV1(serializedResponse, parsedApplicationTamper)
    ).toThrow('request binding')
    expect(
      parseSupabaseBackfillInspectionWireResponseV1(serializedResponse, parsedRequest)
        .subjectEnvelope.subject.application.id
    ).toBe(original.application.applicationId)
  })

  test('rejects a response that echoes the right digest with a foreign subject application or target', () => {
    const { parsedRequest, serializedResponse } = completeExchange()

    for (const mutation of [
      (subject: Record<string, unknown>) => {
        ;(subject.application as Record<string, unknown>).id = 'test.supabase-foreign-backfill'
      },
      (subject: Record<string, unknown>) => {
        ;(subject.plan as Record<string, unknown>).target = 'vue'
      }
    ]) {
      const response = JSON.parse(serializedResponse) as Record<string, unknown>
      const envelope = response.subjectEnvelope as Record<string, unknown>
      const subject = envelope.subject as Record<string, unknown>
      mutation(subject)
      envelope.subjectDigest = digestCanonicalForTest(subject)
      expect(() =>
        parseSupabaseBackfillInspectionWireResponseV1(canonicalFrame(response), parsedRequest)
      ).toThrow('deterministic Compiler result')
    }
  })

  test('rejects null, digest drift, binding drift, and unknown fields anywhere in the subject', () => {
    const { parsedRequest, serializedResponse } = completeExchange()
    const mutations: readonly ((subject: Record<string, unknown>) => void)[] = [
      (subject) => {
        subject.emission = null
      },
      (subject) => {
        subject.migration = null
      },
      (subject) => {
        ;(subject.plan as Record<string, unknown>).digest = digest('openpencil:test:foreign-plan')
      },
      (subject) => {
        ;(subject.plan as Record<string, unknown>).adapterPlanDigest = digest(
          'openpencil:test:foreign-adapter-plan'
        )
      },
      (subject) => {
        ;(subject.plan as Record<string, unknown>).mode = 'preview'
      },
      (subject) => {
        ;(subject.emission as Record<string, unknown>).unexpected = false
      },
      (subject) => {
        ;(subject.migration as Record<string, unknown>).unexpected = false
      }
    ]

    for (const mutate of mutations) {
      const response = JSON.parse(serializedResponse) as Record<string, unknown>
      const envelope = response.subjectEnvelope as Record<string, unknown>
      const subject = envelope.subject as Record<string, unknown>
      mutate(subject)
      envelope.subjectDigest = digestCanonicalForTest(subject)
      expect(() =>
        parseSupabaseBackfillInspectionWireResponseV1(canonicalFrame(response), parsedRequest)
      ).toThrow('deterministic Compiler result')
    }
  })

  test('emits one exact response contract with no install, execution, or release authority', () => {
    const { parsedRequest, serializedResponse } = completeExchange()
    const response = parseSupabaseBackfillInspectionWireResponseV1(
      serializedResponse,
      parsedRequest
    )
    const authority = response.compilerBuildAuthority

    expect(Object.keys(response).sort()).toEqual([
      'compilerBuildAuthority',
      'requestDigest',
      'requestNonce',
      'subjectEnvelope',
      'version'
    ])
    expect(authority).toEqual(createSupabaseBackfillCompilerBuildAuthorityV1())
    expect([
      authority.networkAuthorityCreated,
      authority.credentialAuthorityCreated,
      authority.sqlExecutionAuthorityCreated,
      authority.appBundleAuthorityCreated,
      authority.installAuthorityCreated,
      authority.executionAuthorityCreated,
      authority.releaseAuthorityCreated
    ]).toEqual([false, false, false, false, false, false, false])
  })

  test('rejects forged Compiler authority and foreign compiler-selection package binding', () => {
    const { parsedRequest, serializedResponse } = completeExchange()
    const responseFieldTamper = JSON.parse(serializedResponse) as Record<string, unknown>
    responseFieldTamper.mode = 'production'
    expect(() =>
      parseSupabaseBackfillInspectionWireResponseV1(
        canonicalFrame(responseFieldTamper),
        parsedRequest
      )
    ).toThrow('exact protocol fields')

    const authorityTamper = JSON.parse(serializedResponse) as Record<string, unknown>
    ;(authorityTamper.compilerBuildAuthority as Record<string, unknown>).installAuthorityCreated =
      true
    expect(() =>
      parseSupabaseBackfillInspectionWireResponseV1(canonicalFrame(authorityTamper), parsedRequest)
    ).toThrow('not trusted')

    const descriptorTamper = JSON.parse(serializedResponse) as Record<string, unknown>
    const compilerBuildAuthority = descriptorTamper.compilerBuildAuthority as Record<
      string,
      unknown
    >
    const compilerTrustDomain = compilerBuildAuthority.compilerTrustDomain as Record<
      string,
      unknown
    >
    const compilerDescriptor = compilerTrustDomain.descriptor as Record<string, unknown>
    const trustProfile = compilerDescriptor.trustProfile as Record<string, unknown>
    ;(trustProfile.output as Record<string, unknown>).queryFamily =
      'openpencil.supabase-backfill-catalog-inspection.foreign'
    expect(() =>
      parseSupabaseBackfillInspectionWireResponseV1(canonicalFrame(descriptorTamper), parsedRequest)
    ).toThrow('not trusted')

    const packageTamper = JSON.parse(serializedResponse) as Record<string, unknown>
    const envelope = packageTamper.subjectEnvelope as Record<string, unknown>
    const subject = envelope.subject as Record<string, unknown>
    ;(subject.providerAuthority as Record<string, unknown>).packageDigest =
      `sha256:${digest('openpencil:test:foreign-compiler-trust-domain')}`
    envelope.subjectDigest = digestCanonicalForTest(subject)
    expect(() =>
      parseSupabaseBackfillInspectionWireResponseV1(canonicalFrame(packageTamper), parsedRequest)
    ).toThrow('deterministic Compiler result')
  })

  test('response constructor rejects a mismatched request digest before serialization', () => {
    const parsedRequest = parseSupabaseBackfillInspectionWireRequestV1(
      serializeSupabaseBackfillInspectionWireRequestV1(request())
    )
    expect(() =>
      createSupabaseBackfillInspectionWireResponseV1({
        request: parsedRequest.request,
        requestDigest: digest('openpencil:test:mismatched-request'),
        subjectEnvelope: subjectFor(parsedRequest.request)
      })
    ).toThrow('request digest does not match')
  })
})

function digestCanonicalForTest(value: unknown): string {
  return createHash('sha256').update(canonicalFrame(value)).digest('base64url')
}
