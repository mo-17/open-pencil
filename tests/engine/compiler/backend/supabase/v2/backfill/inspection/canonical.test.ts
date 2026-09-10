import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  createSupabaseBackfillInspectionSubjectV1,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2
} from '@open-pencil/compiler'
import { canonicalManifestJSON, digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  supabaseBackfillApplicationV2,
  supabasePrivateRealtimeSelectionV2
} from '#tests/engine/compiler/backend/supabase/v2/helpers'

type InspectionEnvelopeV1 = ReturnType<typeof createSupabaseBackfillInspectionSubjectV1>
type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T
type MutableInspectionSubjectV1 = Mutable<InspectionEnvelopeV1['subject']>

interface InspectionProjectionV1 {
  readonly providerId: string
  readonly providerAuthorityDigest: string
  readonly applicationId: string
  readonly applicationDigest: string
  readonly migrationId: string
  readonly migrationDigest: string
  readonly migrationPlanDigest: string
  readonly inspectionSubjectDigest: string
  readonly tableName: string
  readonly cursorField: string
  readonly targetField: string
  readonly maximumCursor: number
  readonly batchSize: number
  readonly maximumBatchReceiptCount: number
}

interface InspectionCanonicalFixtureV1 {
  readonly fixtureFormat: string
  readonly fixtureVersion: number
  readonly envelope: InspectionEnvelopeV1
  readonly projection: InspectionProjectionV1
}

function readFixture(name: string): InspectionCanonicalFixtureV1 {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../../../../fixtures/backend/supabase/${name}`, import.meta.url),
      'utf8'
    )
  ) as InspectionCanonicalFixtureV1
}

const fixture = readFixture('backfill-inspection-subject-v1.json')
const floatFixture = readFixture('backfill-inspection-subject-float-v1.json')

const PROJECTION_KEYS = [
  'applicationDigest',
  'applicationId',
  'batchSize',
  'cursorField',
  'inspectionSubjectDigest',
  'maximumBatchReceiptCount',
  'maximumCursor',
  'migrationDigest',
  'migrationId',
  'migrationPlanDigest',
  'providerAuthorityDigest',
  'providerId',
  'tableName',
  'targetField'
]

function actualEnvelope(): InspectionEnvelopeV1 {
  const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
  const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2)
  const planned = createBackendProviderPlanV2(registry, {
    selection,
    application: supabaseBackfillApplicationV2(),
    target: 'react',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  return createSupabaseBackfillInspectionSubjectV1(registry, {
    plan: planned.plan,
    selection
  })
}

function actualFloatEnvelope(): InspectionEnvelopeV1 {
  const application = supabaseBackfillApplicationV2()
  application.applicationId = 'test:float-backfill'
  application.dataModel.entities[0].fields[1] = {
    ...application.dataModel.entities[0].fields[1],
    type: 'number',
    default: { kind: 'literal', value: 1.5 }
  }
  application.dataMigrations.migrations[0].transforms = [
    { kind: 'set-literal', fieldId: 'account-status', value: 1.5 }
  ]
  application.dataMigrations.migrations[0].postconditions = [
    { kind: 'field-not-null', fieldId: 'account-status' }
  ]
  const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
  const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2)
  const planned = createBackendProviderPlanV2(registry, {
    selection,
    application,
    target: 'vue',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  return createSupabaseBackfillInspectionSubjectV1(registry, {
    plan: planned.plan,
    selection
  })
}

function projectionFromEnvelope(envelope: InspectionEnvelopeV1): InspectionProjectionV1 {
  const { subject } = envelope
  return {
    providerId: subject.providerId,
    providerAuthorityDigest: subject.providerAuthority.digest,
    applicationId: subject.application.id,
    applicationDigest: subject.application.digest,
    migrationId: subject.migration.id,
    migrationDigest: subject.migration.digest,
    migrationPlanDigest: subject.emission.artifacts.migrationPlan.digest,
    inspectionSubjectDigest: envelope.subjectDigest,
    tableName: subject.migration.entity.table,
    cursorField: subject.migration.cursor.field,
    targetField: subject.migration.target.field,
    maximumCursor: subject.migration.cursor.maximum,
    batchSize: subject.migration.batchSize,
    maximumBatchReceiptCount: subject.migration.maximumBatchReceiptCount
  }
}

function reversedInsertionOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedInsertionOrder)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reversedInsertionOrder(entry)])
  )
}

function changedSubject(
  mutate: (subject: MutableInspectionSubjectV1) => void
): MutableInspectionSubjectV1 {
  const subject = structuredClone(fixture.envelope.subject) as MutableInspectionSubjectV1
  mutate(subject)
  return subject
}

function collectValues(value: unknown): {
  readonly keys: readonly string[]
  readonly numbers: readonly number[]
  readonly strings: readonly string[]
} {
  const keys: string[] = []
  const numbers: number[] = []
  const strings: string[] = []
  const visit = (entry: unknown): void => {
    if (typeof entry === 'string') {
      strings.push(entry)
      return
    }
    if (typeof entry === 'number') {
      numbers.push(entry)
      return
    }
    if (entry === null || typeof entry !== 'object') return
    if (Array.isArray(entry)) {
      entry.forEach(visit)
      return
    }
    for (const [key, nested] of Object.entries(entry)) {
      keys.push(key)
      visit(nested)
    }
  }
  visit(value)
  return { keys, numbers, strings }
}

describe('Supabase V2 backfill inspection canonical fixture', () => {
  test('pins the real Compiler envelope and the exact 14-field initializer projection', () => {
    const actual = actualEnvelope()

    expect(Object.keys(fixture).sort()).toEqual([
      'envelope',
      'fixtureFormat',
      'fixtureVersion',
      'projection'
    ])
    expect(fixture.fixtureFormat).toBe(
      'openpencil.test.backend.supabase.backfill-inspection-subject.v1'
    )
    expect(fixture.fixtureVersion).toBe(1)
    expect(fixture.envelope).toEqual(actual)
    expect(Object.keys(fixture.projection).sort()).toEqual(PROJECTION_KEYS)
    expect(fixture.projection).toEqual(projectionFromEnvelope(actual))
    expect(fixture.projection.migrationPlanDigest).toBe(
      actual.subject.emission.artifacts.migrationPlan.digest
    )
    expect(fixture.projection.inspectionSubjectDigest).toBe(actual.subjectDigest)
  })

  test('pins the shared canonical digest independent of object insertion order', async () => {
    const subject = fixture.envelope.subject
    const reordered = reversedInsertionOrder(subject)

    expect(fixture.envelope.subjectDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(await digestCanonicalManifest(subject)).toBe(fixture.envelope.subjectDigest)
    expect(canonicalManifestJSON(reordered)).toBe(canonicalManifestJSON(subject))
    expect(await digestCanonicalManifest(reordered)).toBe(fixture.envelope.subjectDigest)
  })

  test('pins the real finite-float and optional matched-row variant across JS and Rust', async () => {
    const actual = actualFloatEnvelope()

    expect(floatFixture.fixtureFormat).toBe(
      'openpencil.test.backend.supabase.backfill-inspection-subject-float.v1'
    )
    expect(floatFixture.envelope).toEqual(actual)
    expect(floatFixture.projection).toEqual(projectionFromEnvelope(actual))
    expect(actual.subject.migration.target).toMatchObject({
      postgresType: 'pg_catalog.float8',
      expectedLiteral: 1.5
    })
    expect(actual.subject.migration.requiredMatchedRowCount).toBeNull()
    expect(await digestCanonicalManifest(actual.subject)).toBe(
      'ATiXbwjwvx9pOGdqm1tweQlyN4CwIlMCSAC3xzX3vtc'
    )
  })

  test('changes the canonical digest when any bound semantic domain is tampered', async () => {
    const changed = [
      changedSubject((subject) => {
        subject.providerAuthority.digest = 'A'.repeat(43)
      }),
      changedSubject((subject) => {
        subject.application.id = 'test.foreign-application'
      }),
      changedSubject((subject) => {
        subject.plan.digest = 'B'.repeat(43)
      }),
      changedSubject((subject) => {
        subject.emission.artifacts.migrationPlan.digest = 'C'.repeat(43)
      }),
      changedSubject((subject) => {
        subject.migration.batchSize = 251
      }),
      changedSubject((subject) => {
        subject.inspection.queryFamily = 'openpencil.supabase-backfill-catalog-inspection.foreign'
      })
    ]

    for (const subject of changed) {
      expect(await digestCanonicalManifest(subject)).not.toBe(fixture.envelope.subjectDigest)
    }
  })

  test('remains review-only, secret-free, SQL-free, and safe across the JS/Rust number boundary', () => {
    const { subject } = fixture.envelope
    expect(subject).toMatchObject({
      format: 'openpencil.supabase-backfill-inspection-subject.v1',
      version: 1,
      providerId: 'supabase',
      reviewOnly: true,
      applyAvailable: false,
      releaseReady: false,
      executionAuthorityCreated: false,
      plan: { target: 'react', mode: 'production' },
      inspection: {
        queryFamily: 'openpencil.supabase-backfill-catalog-inspection.v1',
        catalogOnly: true,
        generatedReviewSqlIsAuthority: false,
        observedHighWaterIsLockedCapture: false,
        mayCreateReceipt: false
      }
    })

    const { keys, numbers, strings } = collectValues(fixture)
    expect(keys.filter((key) => /(?:credential|password|secret|token)/i.test(key))).toEqual([])
    expect(keys.filter((key) => /(?:permit|proof|handle|precommit)/i.test(key))).toEqual([])
    expect(keys.filter((key) => /^(?:endpoint|pat|sql|url|uri)$/i.test(key))).toEqual([])
    expect(numbers.every((value) => Number.isSafeInteger(value))).toBe(true)
    for (const value of strings) {
      expect(value).not.toMatch(/(?:https?|postgres(?:ql)?):\/\//i)
      expect(value).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s|service[_-]?role/i)
      expect(value).not.toMatch(/\b(?:select|insert|update|delete|create|alter|drop)\s+/i)
    }
  })
})
