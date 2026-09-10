import { describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { canonicalManifestJSON as canonicalJSON } from '@open-pencil/scene-graph'

type JSONPrimitive = boolean | null | number | string
type JSONValue = JSONObject | JSONPrimitive | readonly JSONValue[]
interface JSONObject {
  readonly [key: string]: JSONValue
}

type InitializerMaterialV1 = JSONObject & {
  readonly source: JSONObject
  readonly installed: JSONObject
  readonly inspection: JSONObject
  readonly capture: JSONObject
  readonly transaction: JSONObject & { readonly parameters: JSONObject }
}

interface InitializerCanonicalFixtureV1 {
  readonly fixtureFormat: string
  readonly fixtureVersion: number
  readonly initializerFormat: string
  readonly initializerVersion: number
  readonly planDomain: string
  readonly singleFlightDomain: string
  readonly scopeDomain: string
  readonly captureConsumed: boolean
  readonly material: InitializerMaterialV1
  readonly planDigest: string
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../../../../fixtures/backend/supabase/receipt-zero-initializer-canonical-v1.json',
      import.meta.url
    ),
    'utf8'
  )
) as InitializerCanonicalFixtureV1

function sha256Base64url(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function digestCanonical(value: JSONValue): string {
  return sha256Base64url(canonicalJSON(value))
}

function decodeCanonicalBase64(value: string): JSONObject {
  const decoded = Buffer.from(value, 'base64').toString('utf8')
  const parsed = JSON.parse(decoded) as JSONObject
  expect(decoded).toBe(canonicalJSON(parsed))
  return parsed
}

function digestCanonicalDomain(domain: string, value: JSONValue): string {
  const hash = createHash('sha256')
  hash.update(domain, 'utf8')
  hash.update(Uint8Array.of(0))
  hash.update(canonicalJSON(value), 'utf8')
  return hash.digest('base64url')
}

function requiredString(owner: JSONObject, key: string): string {
  const value = owner[key]
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`)
  return value
}

function requiredNumber(owner: JSONObject, key: string): number {
  const value = owner[key]
  if (typeof value !== 'number') throw new TypeError(`${key} must be a number`)
  return value
}

function initializerIdentity(material: InitializerMaterialV1) {
  const planDigest = digestCanonicalDomain(fixture.planDomain, {
    format: fixture.initializerFormat,
    version: fixture.initializerVersion,
    material
  })
  return {
    planDigest,
    singleFlightKey: digestCanonicalDomain(fixture.singleFlightDomain, [
      'supabase-backfill-receipt-zero-initializer',
      planDigest
    ]),
    dispatchScopeKey: digestCanonicalDomain(fixture.scopeDomain, {
      format: fixture.initializerFormat,
      version: fixture.initializerVersion,
      providerId: requiredString(material.capture, 'providerId'),
      projectRef: requiredString(material.capture, 'projectRef')
    })
  }
}

function casInstallPlan(material: InitializerMaterialV1): JSONObject {
  const installed = material.installed
  return {
    accountId: installed.accountId,
    baseSqlDigest: installed.baseSqlDigest,
    environment: installed.environment,
    format: 'openpencil.supabase-backfill-database-cas-ledger-install-plan.v1',
    installReviewDigest: installed.installReviewDigest,
    installSqlDigest: installed.installSqlDigest,
    ledgerShapeDigest: installed.ledgerShapeDigest,
    marker: installed.marker,
    markerBindingDigest: installed.markerBindingDigest,
    migrationName: installed.migrationName,
    projectRef: installed.projectRef,
    providerId: installed.providerId,
    readGrantGeneration: installed.readGrantGeneration,
    sourceReviewDigest: installed.sourceReviewDigest,
    verificationDigest: installed.verificationDigest,
    verificationQueryDigest: installed.verificationQueryDigest,
    version: 1,
    writeGrantGeneration: installed.writeGrantGeneration
  }
}

function reversedInsertionOrder(value: JSONValue): JSONValue {
  if (Array.isArray(value)) return value.map(reversedInsertionOrder)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reversedInsertionOrder(entry)])
  )
}

function mutated(
  domain: 'capture' | 'inspection' | 'installed' | 'source' | 'transaction',
  key: string,
  value: JSONValue
): InitializerMaterialV1 {
  const material = structuredClone(fixture.material)
  ;(material[domain] as { [key: string]: JSONValue })[key] = value
  return material
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort()
}

function collectFixtureValues(value: unknown): {
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

const TOP_LEVEL_KEYS = [
  'captureConsumed',
  'dispatchScopeKey',
  'fixtureFormat',
  'fixtureVersion',
  'initializerFormat',
  'initializerVersion',
  'material',
  'planDigest',
  'planDomain',
  'scopeDomain',
  'singleFlightDomain',
  'singleFlightKey'
]

const SOURCE_KEYS = [
  'accountId',
  'applicationDigest',
  'applicationId',
  'attestationDigest',
  'ciProvider',
  'databaseHistoryDigest',
  'dbPushCommandDigest',
  'dbPushReceiptDigest',
  'environment',
  'expectationDigest',
  'grantGeneration',
  'migrationDigest',
  'migrationId',
  'migrationPlanDigest',
  'payloadDigest',
  'projectRef',
  'protectedRef',
  'providerAuthorityDigest',
  'providerId',
  'repository',
  'revision',
  'runAttempt',
  'runId',
  'schemaDigest',
  'scopeDigest',
  'sourceLedgerDigest',
  'subjectDigest',
  'workflow'
]

const INSTALLED_KEYS = [
  'accountId',
  'baseSqlDigest',
  'environment',
  'installReviewDigest',
  'installSqlDigest',
  'installedVerificationDigest',
  'ledgerShapeDigest',
  'marker',
  'markerBindingDigest',
  'migrationName',
  'observedAt',
  'projectRef',
  'providerId',
  'readGrantGeneration',
  'serverVersionNum',
  'snapshotMarker',
  'sourceReviewDigest',
  'verificationDigest',
  'verificationQueryDigest',
  'writeGrantGeneration'
]

const INSPECTION_KEYS = [
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

const CAPTURE_KEYS = [
  'accessMode',
  'accountId',
  'allCaptureChecksPassed',
  'applicationDigest',
  'applicationId',
  'attestationDigest',
  'barrierConstraintOid',
  'batchSize',
  'captureDigest',
  'captureReviewDigest',
  'captureWriteGrantGeneration',
  'capturedHighWater',
  'catalogPreconditionDigest',
  'currentAndSessionRoleMatch',
  'cursorField',
  'cursorRangeSafe',
  'cursorSubId',
  'cursorTypeOid',
  'databasePrimary',
  'environment',
  'exactAddressMatches',
  'fullTableReadAuthorityObserved',
  'inspectionSubjectDigest',
  'installPlanDigest',
  'installReviewDigest',
  'installWriteGrantGeneration',
  'installedVerificationDigest',
  'lockMode',
  'markerBindingDigest',
  'maximumBatchReceiptCount',
  'maximumCursor',
  'migrationDigest',
  'migrationId',
  'migrationPlanDigest',
  'minimumCursor',
  'observedAt',
  'primaryKeyOid',
  'projectRef',
  'providerAuthorityDigest',
  'providerId',
  'queryBindingsMatch',
  'queryDigest',
  'readGrantGeneration',
  'receiptCapacityFits',
  'remainingNullTargetRowCount',
  'requiredBatchReceiptCount',
  'rowSecurity',
  'schemaDigest',
  'schemaName',
  'schemaOid',
  'searchPath',
  'sequenceOid',
  'serverVersionNum',
  'snapshotMarker',
  'snapshotScope',
  'sourceGrantGeneration',
  'sourceLedgerDigest',
  'sourceLedgerSubjectDigest',
  'sourceReviewDigest',
  'sourceScopeDigest',
  'statementCount',
  'tableName',
  'tableOid',
  'targetField',
  'targetSubId',
  'targetTypeOid',
  'totalRowCount',
  'transactionIsolation',
  'transactionReadOnly',
  'unsafeCursorRowCount'
]

const TRANSACTION_KEYS = [
  'accessMode',
  'format',
  'isolation',
  'parameterSchemaDigest',
  'parameterValuesDigest',
  'parameters',
  'queryId',
  'queryVersion',
  'statementCount',
  'transactionSqlDigest',
  'version'
]

const TRANSACTION_PARAMETER_KEYS = [
  'applicationDigest',
  'applicationId',
  'batchSize',
  'candidateCommittedAt',
  'canonicalReceiptBase64',
  'canonicalScopeBase64',
  'captureDigest',
  'capturedHighWater',
  'catalogPreconditionDigest',
  'eventId',
  'executionId',
  'idempotencyKey',
  'initialExecutionStatus',
  'initialRemainingEligibleRowCount',
  'initialRemainingTargetRowCount',
  'migrationDigest',
  'migrationId',
  'migrationPlanDigest',
  'providerAuthorityDigest',
  'receiptDigest',
  'receiptId',
  'requestDigest',
  'requiredBatchCount',
  'requiredMatchedRowCount',
  'resourceIdentityDigest',
  'scopeDigest',
  'sourceLedgerDigest',
  'unauthenticatedOperationEvidenceDigest'
]

const TRANSACTION_PARAMETER_ORDER = [
  'executionId',
  'applicationId',
  'applicationDigest',
  'migrationId',
  'migrationDigest',
  'migrationPlanDigest',
  'providerAuthorityDigest',
  'sourceLedgerDigest',
  'scopeDigest',
  'resourceIdentityDigest',
  'catalogPreconditionDigest',
  'canonicalScopeBase64',
  'captureDigest',
  'capturedHighWater',
  'initialRemainingEligibleRowCount',
  'initialRemainingTargetRowCount',
  'requiredMatchedRowCount',
  'requiredBatchCount',
  'batchSize',
  'initialExecutionStatus',
  'candidateCommittedAt',
  'eventId',
  'receiptId',
  'idempotencyKey',
  'requestDigest',
  'receiptDigest',
  'canonicalReceiptBase64',
  'unauthenticatedOperationEvidenceDigest'
] as const

const DECIMAL_PARAMETER_NAMES = new Set([
  'capturedHighWater',
  'initialRemainingEligibleRowCount',
  'initialRemainingTargetRowCount',
  'requiredMatchedRowCount',
  'requiredBatchCount',
  'batchSize'
])

describe('native Receipt-zero initializer canonical fixture', () => {
  test('pins complete prerequisite and Receipt-zero transaction material', () => {
    expect(fixture.fixtureFormat).toBe(
      'openpencil.test.backend.supabase.receipt-zero-initializer-canonical.v1'
    )
    expect(fixture.fixtureVersion).toBe(1)
    expect(fixture.initializerFormat).toBe(
      'openpencil.native-supabase-backfill-receipt-zero-initializer-claim.v1'
    )
    expect(fixture.initializerVersion).toBe(1)
    expect(fixture.captureConsumed).toBe(false)
    expect(sortedKeys(fixture)).toEqual(TOP_LEVEL_KEYS)
    expect(sortedKeys(fixture.material)).toEqual([
      'capture',
      'inspection',
      'installed',
      'source',
      'transaction'
    ])
    expect(sortedKeys(fixture.material.source)).toEqual(SOURCE_KEYS)
    expect(sortedKeys(fixture.material.installed)).toEqual(INSTALLED_KEYS)
    expect(sortedKeys(fixture.material.inspection)).toEqual(INSPECTION_KEYS)
    expect(sortedKeys(fixture.material.capture)).toEqual(CAPTURE_KEYS)
    expect(sortedKeys(fixture.material.transaction)).toEqual(TRANSACTION_KEYS)
    expect(sortedKeys(fixture.material.transaction.parameters)).toEqual(TRANSACTION_PARAMETER_KEYS)

    expect(fixture.material.source.providerAuthorityDigest).toBe(sha256Base64url('provider:golden'))
    expect(fixture.material.source.applicationDigest).toBe(sha256Base64url('application:golden'))
    expect(fixture.material.source.migrationDigest).toBe(sha256Base64url('migration:golden'))
    expect(fixture.material.source.migrationPlanDigest).toBe(
      sha256Base64url('migration-plan:golden')
    )
    expect(fixture.material.source.sourceLedgerDigest).toBe(sha256Base64url('source-ledger:golden'))
    expect(fixture.material.source.schemaDigest).toBe(sha256Base64url('schema:golden'))
    expect(fixture.material.source.subjectDigest).toBe(sha256Base64url('source-subject:golden'))
    expect(fixture.material.source.scopeDigest).toBe(sha256Base64url('source-scope:golden'))
    expect(Number.isSafeInteger(requiredNumber(fixture.material.source, 'runAttempt'))).toBe(true)
    expect(requiredNumber(fixture.material.source, 'runAttempt')).toBeGreaterThan(0)
    expect(fixture.material.installed.markerBindingDigest).toBe(
      sha256Base64url('marker-binding:golden')
    )
    expect(fixture.material.capture.captureDigest).toBe(sha256Base64url('capture:golden'))
    expect(fixture.material.capture.installPlanDigest).toBe(
      sha256Base64url(canonicalJSON(casInstallPlan(fixture.material)))
    )

    for (const fields of [
      [
        'providerId',
        fixture.material.source,
        fixture.material.installed,
        fixture.material.inspection
      ],
      ['applicationId', fixture.material.source, fixture.material.inspection],
      ['applicationDigest', fixture.material.source, fixture.material.inspection],
      ['migrationId', fixture.material.source, fixture.material.inspection],
      ['migrationDigest', fixture.material.source, fixture.material.inspection],
      ['migrationPlanDigest', fixture.material.source, fixture.material.inspection],
      ['providerAuthorityDigest', fixture.material.source, fixture.material.inspection]
    ] as const) {
      const [key, ...domains] = fields
      expect(new Set(domains.map((domain) => domain[key])).size).toBe(1)
      expect(fixture.material.capture[key]).toBe(domains[0][key])
    }
    expect(fixture.material.capture.projectRef).toBe(fixture.material.source.projectRef)
    expect(fixture.material.capture.projectRef).toBe(fixture.material.installed.projectRef)
    expect(fixture.material.capture.sourceLedgerSubjectDigest).toBe(
      fixture.material.source.subjectDigest
    )
    expect(fixture.material.capture.inspectionSubjectDigest).toBe(
      fixture.material.inspection.inspectionSubjectDigest
    )

    const transaction = fixture.material.transaction
    const parameters = transaction.parameters
    expect(transaction.format).toBe(
      'openpencil.native-supabase-backfill-receipt-zero-transaction.v1'
    )
    expect(transaction.version).toBe(1)
    expect(transaction.queryId).toBe('backfill-receipt-zero-cas')
    expect(transaction.queryVersion).toBe('openpencil-supabase-backfill-receipt-zero-cas-v1')
    expect(transaction.statementCount).toBe(1)
    expect(transaction.isolation).toBe('serializable')
    expect(transaction.accessMode).toBe('read-write')
    expect(transaction.transactionSqlDigest).toBe('ROtzUuqaSQ8SQa-B49dWe9lP1F2Tcu0wljVFaabAchc')
    expect(transaction.parameterSchemaDigest).toBe('3j14xx4T8NmZ8gNpc3OlylDz4zSt3sIj2zVnykaHumo')

    const scope = decodeCanonicalBase64(requiredString(parameters, 'canonicalScopeBase64'))
    const receipt = decodeCanonicalBase64(requiredString(parameters, 'canonicalReceiptBase64'))
    expect(Buffer.from(canonicalJSON(scope), 'utf8').toString('base64')).toBe(
      parameters.canonicalScopeBase64
    )
    expect(Buffer.from(canonicalJSON(receipt), 'utf8').toString('base64')).toBe(
      parameters.canonicalReceiptBase64
    )
    expect(parameters.scopeDigest).toBe(digestCanonical(scope))
    expect(parameters.receiptDigest).toBe(digestCanonical(receipt))
    expect(receipt.scope).toEqual(scope)
    expect(receipt.scopeDigest).toBe(parameters.scopeDigest)

    const resourceIdentity = {
      format: 'openpencil.supabase-backfill-resource-identity.v1',
      projectRef: fixture.material.capture.projectRef,
      address: {
        schemaName: fixture.material.capture.schemaName,
        schemaOid: fixture.material.capture.schemaOid,
        tableName: fixture.material.capture.tableName,
        tableOid: fixture.material.capture.tableOid,
        cursorField: fixture.material.capture.cursorField,
        cursorSubId: fixture.material.capture.cursorSubId,
        cursorTypeOid: fixture.material.capture.cursorTypeOid,
        targetField: fixture.material.capture.targetField,
        targetSubId: fixture.material.capture.targetSubId,
        targetTypeOid: fixture.material.capture.targetTypeOid,
        primaryKeyOid: fixture.material.capture.primaryKeyOid,
        sequenceOid: fixture.material.capture.sequenceOid,
        barrierConstraintOid: fixture.material.capture.barrierConstraintOid
      }
    }
    expect(parameters.resourceIdentityDigest).toBe(digestCanonical(resourceIdentity))

    for (const key of [
      'applicationId',
      'applicationDigest',
      'migrationId',
      'migrationDigest',
      'migrationPlanDigest',
      'providerAuthorityDigest',
      'sourceLedgerDigest'
    ]) {
      expect(parameters[key]).toBe(fixture.material.source[key])
      expect(scope[key]).toBe(fixture.material.source[key])
    }
    expect(parameters.captureDigest).toBe(fixture.material.capture.captureDigest)
    expect(parameters.catalogPreconditionDigest).toBe(
      fixture.material.capture.catalogPreconditionDigest
    )
    expect(parameters.capturedHighWater).toBe(fixture.material.capture.capturedHighWater)
    expect(parameters.initialRemainingEligibleRowCount).toBe(fixture.material.capture.totalRowCount)
    expect(parameters.initialRemainingTargetRowCount).toBe(
      fixture.material.capture.remainingNullTargetRowCount
    )
    expect(parameters.requiredBatchCount).toBe(fixture.material.capture.requiredBatchReceiptCount)
    expect(parameters.batchSize).toBe(fixture.material.capture.batchSize)
    expect(receipt.executionId).toBe(parameters.executionId)
    expect(receipt.databaseEventId).toBe(parameters.eventId)
    expect(receipt.receiptId).toBe(parameters.receiptId)
    expect(receipt.idempotencyKey).toBe(parameters.idempotencyKey)
    expect(receipt.requestDigest).toBe(parameters.requestDigest)
    expect(receipt.operationAuthorityDigest).toBe(parameters.unauthenticatedOperationEvidenceDigest)
    expect(receipt.committedAt).toBe(parameters.candidateCommittedAt)

    const values = TRANSACTION_PARAMETER_ORDER.map((name) => {
      const value = parameters[name]
      return DECIMAL_PARAMETER_NAMES.has(name) && value !== null ? String(value) : value
    })
    expect(values).toHaveLength(28)
    expect(transaction.parameterValuesDigest).toBe(
      digestCanonical({
        format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1',
        version: 1,
        order: TRANSACTION_PARAMETER_ORDER,
        values
      })
    )
  })

  test('pins plan, single-flight, and stable-scope digests independent of object insertion order', () => {
    expect(fixture.planDomain).toBe('openpencil.native-receipt-zero-initializer-plan.v1')
    expect(fixture.singleFlightDomain).toBe(
      'openpencil.native-receipt-zero-initializer-single-flight.v1'
    )
    expect(fixture.scopeDomain).toBe('openpencil.native-receipt-zero-initializer-stable-scope.v1')
    expect(initializerIdentity(fixture.material)).toEqual({
      planDigest: fixture.planDigest,
      singleFlightKey: fixture.singleFlightKey,
      dispatchScopeKey: fixture.dispatchScopeKey
    })

    const reordered = reversedInsertionOrder(fixture.material) as InitializerMaterialV1
    expect(canonicalJSON(reordered)).toBe(canonicalJSON(fixture.material))
    expect(initializerIdentity(reordered)).toEqual(initializerIdentity(fixture.material))
  })

  test('binds every prerequisite and exact transaction material while keeping scope stable', () => {
    const baseline = initializerIdentity(fixture.material)
    for (const material of [
      mutated('source', 'revision', 'revision-mutated'),
      mutated('installed', 'snapshotMarker', '1:2,3:5'),
      mutated('inspection', 'batchSize', 26),
      mutated('capture', 'capturedHighWater', 43),
      mutated('transaction', 'queryVersion', 'forged-query-version')
    ]) {
      const changed = initializerIdentity(material)
      expect(changed.planDigest).not.toBe(baseline.planDigest)
      expect(changed.singleFlightKey).not.toBe(baseline.singleFlightKey)
      expect(changed.dispatchScopeKey).toBe(baseline.dispatchScopeKey)
    }

    const moved = structuredClone(fixture.material)
    for (const domain of [moved.source, moved.installed, moved.capture]) {
      ;(domain as { [key: string]: JSONValue }).projectRef = 'bcdefghijklmnopqrstu'
    }
    const movedIdentity = initializerIdentity(moved)
    expect(movedIdentity.dispatchScopeKey).not.toBe(baseline.dispatchScopeKey)
    expect(movedIdentity.planDigest).not.toBe(baseline.planDigest)
  })

  test('contains digests and observations, never raw secrets, SQL, URLs, or runtime authority', () => {
    const { keys, numbers, strings } = collectFixtureValues(fixture)
    const forbiddenTopLevel = new Set([
      'authority',
      'credential',
      'endpoint',
      'pat',
      'personalAccessToken',
      'precommit',
      'sql',
      'url'
    ])
    expect(Object.keys(fixture).filter((key) => forbiddenTopLevel.has(key))).toEqual([])
    expect(keys.filter((key) => /(?:secret|password|token|credential)/i.test(key))).toEqual([])
    expect(keys.filter((key) => /(?:endpoint|precommit)/i.test(key))).toEqual([])
    expect(keys.filter((key) => /(?:url|uri)$/i.test(key))).toEqual([])
    expect(keys.filter((key) => /sql/i.test(key) && !key.endsWith('Digest'))).toEqual([])
    expect(
      keys.filter(
        (key) =>
          /(?:authority|capability|permit|handle|proof)/i.test(key) &&
          !/(?:Digest|Observed)$/.test(key)
      )
    ).toEqual([])
    expect(numbers.every((value) => Number.isSafeInteger(value))).toBe(true)
    for (const value of strings) {
      expect(value).not.toMatch(/(?:https?|postgres(?:ql)?):\/\//i)
      expect(value).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s|service[_-]?role/i)
      expect(value).not.toMatch(/\b(?:select|insert|update|delete|create|alter|drop)\s+/i)
    }
  })
})
