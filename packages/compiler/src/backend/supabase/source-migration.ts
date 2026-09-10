/* eslint-disable complexity, max-lines -- Source-ledger validation and emission reproduction keep one public trust boundary auditable. */
/* oxlint-disable typescript-eslint(no-unnecessary-condition), typescript-eslint(no-unnecessary-boolean-literal-compare), typescript-eslint(no-redundant-type-constituents) -- Public compiler values and artifact maps remain runtime-untrusted despite their static contract types. */
import {
  canonicalSourceMigrationLedgerBytes,
  containsBackendSecretLikeMaterial,
  digestStagedMigrationExecutionPlan,
  normalizeStagedMigrationExecutionPlan,
  parseBackendApplicationSpecV1,
  transitionSourceMigrationLedger,
  validateMigrationPlan,
  verifySourceMigrationLedgerIntegrity,
  type BackendDiagnostic,
  type BackendValidationResult,
  type MigrationPlan,
  type SourceMigrationLedgerV1,
  type StagedMigrationExecutionPlanV1
} from '@open-pencil/lowcode/backend'

import {
  backendSha256,
  canonicalBackendValue,
  digestCanonicalBackendValue,
  freezeBackendValue
} from '../canonical'
import type { BackendArtifactManifestV1, BackendProviderEmission } from '../contracts'
import { BACKEND_ARTIFACT_MANIFEST_PATH, emitBackendProviderPlan } from '../emit'
import { createBackendProviderPlan } from '../plan'
import { BackendProviderRegistry } from '../registry'
import { SUPABASE_ARTIFACT_PATHS } from './artifacts'
import { SUPABASE_BACKEND_PROVIDER_BUNDLE } from './bundle'
import { SUPABASE_BACKEND_PROVIDER_DESCRIPTOR } from './descriptor'
import {
  createSupabaseInspectedMigrationReview,
  digestSupabaseInspectedMigrationReviewManifest,
  type SupabaseInspectedMigrationReviewV1
} from './migration-review'
import { composeAtomicSupabaseSourceMigrationSQL } from './source-migration-sql'
import { renderSupabaseInspectedStorageMigrationSQL } from './storage'

const MIGRATION_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const LEDGER_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const SAFE_SOURCE_PATH = /^[A-Za-z0-9._/@+-]+$/u
const SOURCE_LEDGER_PATH = 'supabase/openpencil-inspected-source-ledger.json'
const PROMOTION_LEDGER_PATH = 'supabase/openpencil-migration-ledger.json'
const SOURCE_MIGRATION_DIRECTORY = 'supabase/migrations/'
const MAX_SOURCE_LEDGER_ENTRIES = 4096
const COMPILER_TARGETS = Object.freeze([
  'react',
  'vue',
  'expo',
  'flutter',
  'wechat-miniprogram',
  'taro',
  'uni-app',
  'mpx'
] as const)
const BACKEND_COMPILATION_MODES = Object.freeze([
  'preview',
  'source-only-prototype',
  'production'
] as const)

export const SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_FORMAT =
  'openpencil.supabase-inspected-source-migration-ledger.v1' as const
export const SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_VERSION = 1 as const

export interface SupabaseInspectedSourceMigrationLedgerEntryV1 {
  readonly migrationId: string
  readonly sequence: number
  readonly name: string
  readonly source: {
    readonly path: string
    readonly digest: string
  }
  readonly reviewManifestDigest: string
  readonly applicationDigest: string
  readonly migrationPlanDigest: string
  readonly stagedExecutionPlanDigest: string | null
  readonly emissionManifestDigest: string
  readonly emissionPlanDigest: string
  readonly storagePolicyArtifactDigest: string | null
  readonly previousEntryDigest: string | null
  readonly registeredAt: string
  readonly entryDigest: string
}

/**
 * Source-control audit index for every inspected, review-ready SQL bundle. Every appended entry also
 * has an exact execution plan in `SourceMigrationLedgerV1`; this independent chain retains the
 * review, Provider emission, and source-file evidence used to derive that authority.
 */
export interface SupabaseInspectedSourceMigrationLedgerV1 {
  readonly format: typeof SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_FORMAT
  readonly version: typeof SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_VERSION
  readonly ledgerId: string
  readonly entries: readonly SupabaseInspectedSourceMigrationLedgerEntryV1[]
  readonly headDigest: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SupabaseSourceMigrationFileV1 {
  readonly kind: 'migration-sql' | 'inspected-source-ledger' | 'promotion-ledger'
  readonly path: string
  readonly mediaType: 'application/sql; charset=utf-8' | 'application/json; charset=utf-8'
  readonly byteLength: number
  readonly digest: string
  readonly content: string
}

type SourceFileReference = Omit<SupabaseSourceMigrationFileV1, 'kind' | 'mediaType' | 'content'>

export interface SupabaseSourceMigrationManifestV1 {
  readonly format: 'openpencil.supabase-source-migration.v1'
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly migrationId: string
  readonly sequence: number
  readonly reviewManifestDigest: string
  readonly applicationDigest: string
  readonly migrationPlanDigest: string
  readonly executionPlanDigest: string | null
  readonly emissionManifestDigest: string
  readonly emissionPlanDigest: string
  readonly reviewSqlDigest: string
  readonly storagePolicyArtifactDigest: string | null
  readonly sourceMigration: SourceFileReference
  readonly inspectedSourceLedger: SourceFileReference
  readonly promotionLedger: SourceFileReference | null
}

export interface SupabaseSourceMigrationBundleV1 {
  readonly manifest: SupabaseSourceMigrationManifestV1
  readonly manifestDigest: string
  readonly files: readonly SupabaseSourceMigrationFileV1[]
  /** Strict Apply/promotion truth for staged and compiler-normalized ordinary reviews. */
  readonly ledger: SourceMigrationLedgerV1
  /** Audit index for all source-controlled inspected reviews. Never grants Apply authority. */
  readonly sourceLedger: SupabaseInspectedSourceMigrationLedgerV1
}

export interface CreateSupabaseSourceMigrationBundleInputV1 {
  readonly reviewed: SupabaseInspectedMigrationReviewV1
  /** Required only when the inspected review declares a staged execution plan. */
  readonly executionPlan?: unknown
  /** Strict Apply/promotion ledger. Ordinary reviews append a compiler-derived expand entry. */
  readonly ledger: unknown
  /** Existing inspected-source audit ledger; callers must persist and return it on every append. */
  readonly sourceLedger: unknown
  /** Exact normalized application used to create both the review and Provider emission. */
  readonly application: unknown
  /** Exact trusted Provider emission; it is deterministically recomputed before any SQL is accepted. */
  readonly emission: unknown
  readonly migrationId: string
  /** Lowercase source-control slug, used in the Supabase migration filename. */
  readonly name: string
  readonly registeredAt: string
}

interface CheckedReview {
  readonly migrationPlan: MigrationPlan
  readonly executionPlan: StagedMigrationExecutionPlanV1 | null
  readonly executionPlanDigest: string | null
}

interface CheckedEmission {
  readonly manifestDigest: string
  readonly planDigest: string
  readonly storagePolicySQL: string | null
  readonly storagePolicyDigest: string | null
}

interface MutableOwnDataRecord {
  [key: string]: unknown
}

interface UntrustedEmissionFields {
  readonly manifest?: unknown
  readonly files?: unknown
  readonly manifestPath?: unknown
  readonly manifestDigest?: unknown
}

function invalid(message: string): never {
  throw new TypeError(`Supabase source migration bundle is invalid: ${message}.`)
}

function sourceLedgerInvalid(message: string): never {
  throw new TypeError(`Supabase inspected source ledger is invalid: ${message}.`)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sortedUniqueStrings(values: readonly string[], label: string): readonly string[] {
  const sorted = [...values].sort((left, right) => left.localeCompare(right, 'en'))
  if (sorted.some((value, index) => index > 0 && value === sorted[index - 1])) {
    return invalid(`${label} contains duplicate operation ids`)
  }
  return sorted
}

function ownDataRecord(
  value: unknown,
  keys: readonly string[],
  path: string
): MutableOwnDataRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return sourceLedgerInvalid(`${path} is not an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return sourceLedgerInvalid(`${path} is not plain data`)
  }
  const actualKeys = Reflect.ownKeys(value)
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return sourceLedgerInvalid(`${path} has unexpected fields`)
  }
  const result = Object.create(null) as MutableOwnDataRecord
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return sourceLedgerInvalid(`${path}.${key} is not an enumerable data property`)
    }
    result[key] = descriptor.value
  }
  return result
}

function canonicalTimestamp(value: unknown, label = 'registeredAt'): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return invalid(`${label} is not a timestamp`)
  }
  const canonical = new Date(value).toISOString()
  if (canonical !== value) return invalid(`${label} is not canonical UTC`)
  return value
}

function ledgerTimestamp(value: unknown, path: string): string {
  try {
    return canonicalTimestamp(value, path)
  } catch {
    return sourceLedgerInvalid(`${path} is not canonical UTC`)
  }
}

function checkedDigest(value: unknown, path: string): string
function checkedDigest(value: unknown, path: string, nullable: true): string | null
function checkedDigest(value: unknown, path: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    return sourceLedgerInvalid(`${path} is not a canonical digest`)
  }
  return value
}

function checkedId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !LEDGER_ID.test(value)) {
    return sourceLedgerInvalid(`${path} is not a safe identifier`)
  }
  return value
}

function checkedName(value: unknown, path: string): string {
  if (typeof value !== 'string' || !MIGRATION_NAME.test(value)) {
    return sourceLedgerInvalid(`${path} is not a safe lowercase slug`)
  }
  return value
}

function checkedSourcePath(value: unknown, path: string): string {
  if (typeof value !== 'string') return sourceLedgerInvalid(`${path} is not text`)
  const segments = value.split('/')
  if (
    !SAFE_SOURCE_PATH.test(value) ||
    !value.startsWith(SOURCE_MIGRATION_DIRECTORY) ||
    value.startsWith('/') ||
    value.includes('\\') ||
    segments.some((entry) => entry === '' || entry === '.' || entry === '..')
  ) {
    return sourceLedgerInvalid(`${path} is not a safe Supabase migration path`)
  }
  return value
}

function migrationPath(registeredAt: string, name: string): string {
  if (!MIGRATION_NAME.test(name)) return invalid('name is not a safe lowercase slug')
  const timestamp = registeredAt.replaceAll(/[^0-9]/gu, '').slice(0, 14)
  if (timestamp.length !== 14) return invalid('registeredAt cannot form a migration version')
  return `${SOURCE_MIGRATION_DIRECTORY}${timestamp}_${name}.sql`
}

function migrationVersionPrefix(path: string): string {
  return path.slice(0, SOURCE_MIGRATION_DIRECTORY.length + 14)
}

type SourceLedgerEntryPayload = Omit<SupabaseInspectedSourceMigrationLedgerEntryV1, 'entryDigest'>

function sourceLedgerEntryDigest(entry: SourceLedgerEntryPayload): string {
  return digestCanonicalBackendValue(entry, '$.supabaseInspectedSourceLedger.entry')
}

function parseSourceLedgerEntry(
  value: unknown,
  index: number,
  previousEntryDigest: string | null
): SupabaseInspectedSourceMigrationLedgerEntryV1 {
  const path = `$.entries[${index}]`
  const source = ownDataRecord(
    value,
    [
      'migrationId',
      'sequence',
      'name',
      'source',
      'reviewManifestDigest',
      'applicationDigest',
      'migrationPlanDigest',
      'stagedExecutionPlanDigest',
      'emissionManifestDigest',
      'emissionPlanDigest',
      'storagePolicyArtifactDigest',
      'previousEntryDigest',
      'registeredAt',
      'entryDigest'
    ],
    path
  )
  const sourceRecord = ownDataRecord(source.source, ['path', 'digest'], `${path}.source`)
  const sequence = source.sequence
  if (!Number.isSafeInteger(sequence) || sequence !== index + 1) {
    return sourceLedgerInvalid(`${path}.sequence is not contiguous`)
  }
  const payload = {
    migrationId: checkedId(source.migrationId, `${path}.migrationId`),
    sequence,
    name: checkedName(source.name, `${path}.name`),
    source: {
      path: checkedSourcePath(sourceRecord.path, `${path}.source.path`),
      digest: checkedDigest(sourceRecord.digest, `${path}.source.digest`)
    },
    reviewManifestDigest: checkedDigest(
      source.reviewManifestDigest,
      `${path}.reviewManifestDigest`
    ),
    applicationDigest: checkedDigest(source.applicationDigest, `${path}.applicationDigest`),
    migrationPlanDigest: checkedDigest(source.migrationPlanDigest, `${path}.migrationPlanDigest`),
    stagedExecutionPlanDigest: checkedDigest(
      source.stagedExecutionPlanDigest,
      `${path}.stagedExecutionPlanDigest`,
      true
    ),
    emissionManifestDigest: checkedDigest(
      source.emissionManifestDigest,
      `${path}.emissionManifestDigest`
    ),
    emissionPlanDigest: checkedDigest(source.emissionPlanDigest, `${path}.emissionPlanDigest`),
    storagePolicyArtifactDigest: checkedDigest(
      source.storagePolicyArtifactDigest,
      `${path}.storagePolicyArtifactDigest`,
      true
    ),
    previousEntryDigest: checkedDigest(
      source.previousEntryDigest,
      `${path}.previousEntryDigest`,
      true
    ),
    registeredAt: ledgerTimestamp(source.registeredAt, `${path}.registeredAt`)
  } satisfies SourceLedgerEntryPayload
  if (payload.previousEntryDigest !== previousEntryDigest) {
    return sourceLedgerInvalid(`${path}.previousEntryDigest breaks the digest chain`)
  }
  const entryDigest = checkedDigest(source.entryDigest, `${path}.entryDigest`)
  if (entryDigest !== sourceLedgerEntryDigest(payload)) {
    return sourceLedgerInvalid(`${path}.entryDigest does not match the canonical entry`)
  }
  return freezeBackendValue({
    ...payload,
    entryDigest
  }) as SupabaseInspectedSourceMigrationLedgerEntryV1
}

function parseSourceLedger(value: unknown): SupabaseInspectedSourceMigrationLedgerV1 {
  const source = ownDataRecord(
    value,
    ['format', 'version', 'ledgerId', 'entries', 'headDigest', 'createdAt', 'updatedAt'],
    '$'
  )
  if (source.format !== SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_FORMAT) {
    return sourceLedgerInvalid('format is unsupported')
  }
  if (source.version !== SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_VERSION) {
    return sourceLedgerInvalid('version is unsupported')
  }
  const ledgerId = checkedId(source.ledgerId, '$.ledgerId')
  if (!Array.isArray(source.entries) || source.entries.length > MAX_SOURCE_LEDGER_ENTRIES) {
    return sourceLedgerInvalid('entries exceed the bounded ledger shape')
  }
  const entries: SupabaseInspectedSourceMigrationLedgerEntryV1[] = []
  for (let index = 0; index < source.entries.length; index += 1) {
    entries.push(
      parseSourceLedgerEntry(source.entries[index], index, entries.at(-1)?.entryDigest ?? null)
    )
  }
  const migrationIds = new Set<string>()
  const sourcePaths = new Set<string>()
  for (const entry of entries) {
    if (migrationIds.has(entry.migrationId)) return sourceLedgerInvalid('migrationId is duplicated')
    if (sourcePaths.has(entry.source.path)) return sourceLedgerInvalid('source path is duplicated')
    migrationIds.add(entry.migrationId)
    sourcePaths.add(entry.source.path)
  }
  const headDigest = checkedDigest(source.headDigest, '$.headDigest', true)
  if (headDigest !== (entries.at(-1)?.entryDigest ?? null)) {
    return sourceLedgerInvalid('headDigest does not match the final entry')
  }
  const createdAt = ledgerTimestamp(source.createdAt, '$.createdAt')
  const updatedAt = ledgerTimestamp(source.updatedAt, '$.updatedAt')
  if (createdAt > updatedAt || entries.some((entry) => entry.registeredAt < createdAt)) {
    return sourceLedgerInvalid('timestamps are not monotonic')
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index].registeredAt < entries[index - 1].registeredAt) {
      return sourceLedgerInvalid('entry timestamps are not monotonic')
    }
  }
  if (entries.length > 0 && updatedAt !== entries.at(-1)?.registeredAt) {
    return sourceLedgerInvalid('updatedAt does not match the final entry')
  }
  if (entries.length === 0 && updatedAt !== createdAt) {
    return sourceLedgerInvalid('an empty ledger must keep updatedAt equal to createdAt')
  }
  if (
    containsBackendSecretLikeMaterial(
      JSON.stringify({ ledgerId, entries, headDigest, createdAt, updatedAt })
    )
  ) {
    return sourceLedgerInvalid('secret-like material is forbidden')
  }
  return freezeBackendValue({
    format: SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_FORMAT,
    version: SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_VERSION,
    ledgerId,
    entries,
    headDigest,
    createdAt,
    updatedAt
  }) as SupabaseInspectedSourceMigrationLedgerV1
}

export function verifySupabaseInspectedSourceMigrationLedgerIntegrity(
  value: unknown
): BackendValidationResult<SupabaseInspectedSourceMigrationLedgerV1> {
  try {
    return { ok: true, value: parseSourceLedger(value), diagnostics: [] }
  } catch {
    const diagnostic: BackendDiagnostic = {
      code: 'supabase-inspected-source-ledger-integrity-invalid',
      severity: 'error',
      path: '$',
      message: 'Supabase inspected source ledger failed strict shape or digest-chain validation.'
    }
    return { ok: false, diagnostics: [diagnostic] }
  }
}

/** Canonical source-control representation shared by the exporter and Host byte verifier. */
export function canonicalSupabaseInspectedSourceMigrationLedgerJSON(value: unknown): string {
  const ledger = parseSourceLedger(value)
  return `${JSON.stringify(
    canonicalBackendValue(ledger, '$.supabaseInspectedSourceLedger'),
    null,
    2
  )}\n`
}

export function createSupabaseInspectedSourceMigrationLedger(input: {
  readonly ledgerId: string
  readonly createdAt: string
}): SupabaseInspectedSourceMigrationLedgerV1 {
  const createdAt = canonicalTimestamp(input.createdAt, 'createdAt')
  const candidate = {
    format: SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_FORMAT,
    version: SUPABASE_INSPECTED_SOURCE_MIGRATION_LEDGER_VERSION,
    ledgerId: input.ledgerId,
    entries: [],
    headDigest: null,
    createdAt,
    updatedAt: createdAt
  }
  const verified = verifySupabaseInspectedSourceMigrationLedgerIntegrity(candidate)
  if (!verified.ok) return sourceLedgerInvalid('new ledger metadata failed validation')
  return verified.value
}

function appendSourceLedgerEntry(
  ledger: SupabaseInspectedSourceMigrationLedgerV1,
  entry: Omit<
    SupabaseInspectedSourceMigrationLedgerEntryV1,
    'sequence' | 'previousEntryDigest' | 'entryDigest'
  >
): SupabaseInspectedSourceMigrationLedgerV1 {
  if (entry.registeredAt < ledger.updatedAt) return invalid('registeredAt precedes source ledger')
  if (ledger.entries.length >= MAX_SOURCE_LEDGER_ENTRIES) return invalid('source ledger is full')
  if (ledger.entries.some((candidate) => candidate.migrationId === entry.migrationId)) {
    return invalid('migrationId already exists in the inspected source ledger')
  }
  if (ledger.entries.some((candidate) => candidate.source.path === entry.source.path)) {
    return invalid('migration source path already exists in the inspected source ledger')
  }
  const payload = {
    ...entry,
    sequence: ledger.entries.length + 1,
    previousEntryDigest: ledger.headDigest
  } satisfies SourceLedgerEntryPayload
  const nextEntry = freezeBackendValue({
    ...payload,
    entryDigest: sourceLedgerEntryDigest(payload)
  }) as SupabaseInspectedSourceMigrationLedgerEntryV1
  return parseSourceLedger({
    ...ledger,
    entries: [...ledger.entries, nextEntry],
    headDigest: nextEntry.entryDigest,
    updatedAt: entry.registeredAt
  })
}

async function checkedExecutionPlan(
  reviewed: SupabaseInspectedMigrationReviewV1,
  migrationPlan: MigrationPlan,
  value: unknown
): Promise<{ readonly plan: StagedMigrationExecutionPlanV1; readonly digest: string }> {
  const plan = reviewed.manifest.stagedExecutionPlan
  if (!plan) return invalid('review has no staged execution plan')
  const suppliedDigest = await digestStagedMigrationExecutionPlan(value)
  const reviewedDigest = await digestStagedMigrationExecutionPlan(plan)
  if (
    !DIGEST.test(suppliedDigest) ||
    suppliedDigest !== reviewedDigest ||
    suppliedDigest !== reviewed.manifest.stagedExecutionPlanDigest
  ) {
    return invalid('execution plan differs from the inspected review')
  }
  const renderedIds = sortedUniqueStrings(
    reviewed.manifest.renderedStagedMigrationOperationIds,
    'rendered staged operation coverage'
  )
  const plannedIds = sortedUniqueStrings(
    plan.operations.map((entry) => entry.operation.id),
    'staged execution plan'
  )
  if (!sameStrings(renderedIds, plannedIds)) {
    return invalid('review did not render the exact staged operation id set')
  }
  if (
    reviewed.manifest.renderedMigrationPhases.length !== 1 ||
    reviewed.manifest.renderedMigrationPhases[0] !== plan.phase
  ) {
    return invalid('review did not render the exact staged migration phase')
  }
  // Ordinary rendered ids are the legacy live-Apply allowlist. A staged review must never mix that
  // authority with its separate source-only staged id set.
  if (reviewed.manifest.renderedMigrationOperationIds.length > 0) {
    return invalid('staged review contains ordinary live-Apply operation authority')
  }
  if (plan.sourceMigrationPlan.targetModelDigest !== migrationPlan.targetModelDigest) {
    return invalid('staged execution target is not bound to the reviewed migration plan')
  }
  if (plan.phase === 'expand') {
    const migrationOperationIds = sortedUniqueStrings(
      migrationPlan.operations.map((entry) => entry.operation.id),
      'reviewed migration plan'
    )
    const referencedSourceOperationIds = sortedUniqueStrings(
      [...new Set(plan.operations.flatMap((entry) => [...entry.operation.sourceOperationIds]))],
      'staged source operation coverage'
    )
    if (
      plan.sourceMigrationPlan.planId !== migrationPlan.planId ||
      plan.sourceMigrationPlan.planDigest !== reviewed.manifest.migrationPlanDigest ||
      plan.sourceMigrationPlan.fromModelDigest !== (migrationPlan.fromModelDigest ?? null) ||
      referencedSourceOperationIds.some((id) => !migrationOperationIds.includes(id))
    ) {
      return invalid('expand execution is not bound to the reviewed source operations')
    }
  }
  return { plan, digest: suppliedDigest }
}

async function checkedReview(
  reviewed: SupabaseInspectedMigrationReviewV1,
  executionPlan: unknown,
  application: unknown
): Promise<CheckedReview> {
  if (
    reviewed.manifest.format !== 'openpencil.supabase-inspected-migration-review.v1' ||
    reviewed.manifest.version !== 1 ||
    reviewed.manifest.providerId !== 'supabase' ||
    reviewed.manifest.environment !== 'staging'
  )
    return invalid('inspected review identity is unsupported')
  if (
    reviewed.manifest.reviewReady !== true ||
    reviewed.manifest.applyAllowed !== false ||
    reviewed.manifest.releaseReady !== false ||
    reviewed.manifest.blockers.length !== 0
  )
    return invalid('inspected review is not source-ready')
  if (reviewed.manifestDigest !== digestSupabaseInspectedMigrationReviewManifest(reviewed.manifest))
    return invalid('inspected review manifest integrity failed')
  if (reviewed.manifest.sqlDigest !== backendSha256(reviewed.sql))
    return invalid('inspected review SQL integrity failed')
  const parsedApplication = parseBackendApplicationSpecV1(application)
  if (!parsedApplication.ok) return invalid('application bound to the inspected review is invalid')
  const migrationPlan = validateMigrationPlan(reviewed.manifest.migrationPlan)
  if (
    !migrationPlan.ok ||
    digestCanonicalBackendValue(migrationPlan.value, '$.supabaseMigrationReview.migrationPlan') !==
      reviewed.manifest.migrationPlanDigest
  ) {
    return invalid('migration plan differs from the inspected review')
  }
  let checked: CheckedReview
  if (reviewed.manifest.stagedExecutionPlan) {
    const execution = await checkedExecutionPlan(reviewed, migrationPlan.value, executionPlan)
    checked = {
      migrationPlan: migrationPlan.value,
      executionPlan: execution.plan,
      executionPlanDigest: execution.digest
    }
  } else {
    if (
      executionPlan !== undefined ||
      reviewed.manifest.stagedExecutionPlanDigest !== null ||
      reviewed.manifest.renderedStagedMigrationOperationIds.length !== 0 ||
      reviewed.manifest.renderedMigrationPhases.length !== 0
    ) {
      return invalid('ordinary review contains unexpected staged execution authority')
    }
    const renderedIds = [...reviewed.manifest.renderedMigrationOperationIds].sort((left, right) =>
      left.localeCompare(right, 'en')
    )
    const plannedIds = migrationPlan.value.operations
      .map((entry) => entry.operation.id)
      .sort((left, right) => left.localeCompare(right, 'en'))
    if (!sameStrings(renderedIds, plannedIds)) {
      return invalid('ordinary review did not render every migration operation')
    }
    checked = {
      migrationPlan: migrationPlan.value,
      executionPlan: null,
      executionPlanDigest: null
    }
  }
  let reproduced: SupabaseInspectedMigrationReviewV1
  try {
    reproduced = await createSupabaseInspectedMigrationReview({
      application: parsedApplication.value,
      snapshot: reviewed.snapshot,
      expectedProjectRef: reviewed.manifest.inspectionProvenance.projectRef,
      expectedAccountId: reviewed.manifest.inspectionProvenance.accountId,
      expectedInspectedSchemaDigest: reviewed.manifest.inspectedSchemaDigest,
      expectedTargetModelDigest: reviewed.manifest.authoredTargetModelDigest,
      environment: 'staging',
      ...(checked.executionPlan
        ? {
            stagedExecution: {
              executionPlan: checked.executionPlan,
              ...(reviewed.manifest.predecessorReceipt
                ? { predecessorReceipt: reviewed.manifest.predecessorReceipt }
                : {})
            }
          }
        : {})
    })
  } catch {
    return invalid('inspected review cannot be reproduced from its bound application and snapshot')
  }
  if (reproduced.manifestDigest !== reviewed.manifestDigest || reproduced.sql !== reviewed.sql) {
    return invalid('inspected review reproduction integrity failed')
  }
  return checked
}

async function ordinaryReviewedExecutionAuthority(
  reviewed: SupabaseInspectedMigrationReviewV1,
  migrationPlan: MigrationPlan,
  sourceSQLDigest: string
): Promise<{ readonly plan: StagedMigrationExecutionPlanV1; readonly digest: string }> {
  const sourceOperationIds = sortedUniqueStrings(
    reviewed.manifest.renderedMigrationOperationIds,
    'ordinary reviewed source operation coverage'
  )
  const plan = normalizeStagedMigrationExecutionPlan({
    format: 'openpencil.staged-migration-execution',
    version: 1,
    executionId: `reviewed:${sourceSQLDigest.slice(0, 24)}`,
    changeId: `reviewed:${reviewed.manifest.migrationPlanDigest.slice(0, 24)}`,
    sourceMigrationPlan: {
      version: 1,
      planId: migrationPlan.planId,
      planDigest: reviewed.manifest.migrationPlanDigest,
      fromModelDigest: migrationPlan.fromModelDigest ?? null,
      targetModelDigest: migrationPlan.targetModelDigest
    },
    phase: 'expand',
    predecessor: null,
    operations: [
      {
        operation: {
          id: `reviewed:${reviewed.manifestDigest.slice(0, 24)}`,
          kind: 'apply-reviewed-migration',
          sourceOperationIds,
          reviewManifestDigest: reviewed.manifestDigest,
          migrationPlanDigest: reviewed.manifest.migrationPlanDigest,
          sqlDigest: sourceSQLDigest,
          appliesTo: 'reviewed-source-sql'
        },
        risk: 'low'
      }
    ],
    highestRisk: 'low',
    requiresHumanApproval: false
  })
  return { plan, digest: await digestStagedMigrationExecutionPlan(plan) }
}

function emissionRecord(value: unknown): {
  readonly emission: BackendProviderEmission
  readonly manifest: BackendArtifactManifestV1
  readonly files: ReadonlyMap<string, string | Uint8Array>
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('emission is not an object')
  }
  let manifest: unknown
  let files: unknown
  let manifestPath: unknown
  let manifestDigest: unknown
  try {
    ;({ manifest, files, manifestPath, manifestDigest } = value as UntrustedEmissionFields)
  } catch {
    return invalid('emission fields are not readable data')
  }
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    files === null ||
    typeof files !== 'object' ||
    typeof (files as ReadonlyMap<string, string | Uint8Array>).get !== 'function' ||
    manifestPath !== BACKEND_ARTIFACT_MANIFEST_PATH ||
    typeof manifestDigest !== 'string' ||
    !DIGEST.test(manifestDigest)
  ) {
    return invalid('emission shape is invalid')
  }
  return {
    emission: value as BackendProviderEmission,
    manifest: manifest as BackendArtifactManifestV1,
    files: files as ReadonlyMap<string, string | Uint8Array>
  }
}

function checkedEmission(
  reviewed: SupabaseInspectedMigrationReviewV1,
  application: unknown,
  value: unknown
): CheckedEmission {
  const supplied = emissionRecord(value)
  const manifest = supplied.manifest
  let manifestContent: string | Uint8Array | undefined
  try {
    manifestContent = supplied.files.get(BACKEND_ARTIFACT_MANIFEST_PATH)
  } catch {
    return invalid('emission files cannot be read')
  }
  if (typeof manifestContent !== 'string') return invalid('emission manifest artifact is missing')
  let canonicalManifestContent: string
  try {
    canonicalManifestContent = `${JSON.stringify(
      canonicalBackendValue(manifest, '$.artifactManifest'),
      null,
      2
    )}\n`
  } catch {
    return invalid('emission manifest is not canonical data')
  }
  if (
    canonicalManifestContent !== manifestContent ||
    backendSha256(manifestContent) !== supplied.emission.manifestDigest ||
    manifest.format !== 'openpencil.backend-artifacts.v1' ||
    manifest.version !== 1 ||
    manifest.authority?.providerId !== 'supabase' ||
    manifest.authority?.adapterId !== SUPABASE_BACKEND_PROVIDER_DESCRIPTOR.adapterId ||
    manifest.applicationDigest !== reviewed.manifest.applicationDigest ||
    !COMPILER_TARGETS.some((target) => target === manifest.target) ||
    !BACKEND_COMPILATION_MODES.some((mode) => mode === manifest.mode)
  ) {
    return invalid('emission manifest integrity or review binding failed')
  }
  const registry = new BackendProviderRegistry([SUPABASE_BACKEND_PROVIDER_BUNDLE])
  const selection = {
    descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
    packageDigest: manifest.authority.packageDigest,
    enabled: true
  } as const
  const planned = createBackendProviderPlan(registry, {
    selection,
    application,
    target: manifest.target,
    mode: manifest.mode
  })
  if (!planned.ok) {
    return invalid(
      `emission application failed trusted planning (${planned.diagnostics
        .map((entry) => entry.code)
        .join(', ')})`
    )
  }
  if (
    planned.plan.applicationDigest !== reviewed.manifest.applicationDigest ||
    planned.plan.planDigest !== manifest.planDigest
  ) {
    return invalid('emission application or Provider plan differs from the inspected review')
  }
  const recomputed = emitBackendProviderPlan(registry, { selection, plan: planned.plan })
  if (!recomputed.ok) {
    return invalid(
      `emission failed deterministic reproduction (${recomputed.diagnostics
        .map((entry) => entry.code)
        .join(', ')})`
    )
  }
  const expectedManifestContent = recomputed.emission.files.get(BACKEND_ARTIFACT_MANIFEST_PATH)
  if (
    typeof expectedManifestContent !== 'string' ||
    expectedManifestContent !== manifestContent ||
    recomputed.emission.manifestDigest !== supplied.emission.manifestDigest
  ) {
    return invalid('emission differs from the trusted deterministic Provider output')
  }
  const expectedStorage = recomputed.emission.files.get(SUPABASE_ARTIFACT_PATHS.storagePolicy)
  let suppliedStorage: string | Uint8Array | undefined
  try {
    suppliedStorage = supplied.files.get(SUPABASE_ARTIFACT_PATHS.storagePolicy)
  } catch {
    return invalid('emission Storage artifact cannot be read')
  }
  if (expectedStorage === undefined) {
    if (suppliedStorage !== undefined) return invalid('emission contains unexpected Storage SQL')
    return {
      manifestDigest: recomputed.emission.manifestDigest,
      planDigest: planned.plan.planDigest,
      storagePolicySQL: null,
      storagePolicyDigest: null
    }
  }
  if (
    typeof expectedStorage !== 'string' ||
    suppliedStorage !== expectedStorage ||
    containsBackendSecretLikeMaterial(expectedStorage)
  ) {
    return invalid('emission Storage SQL differs from the trusted Provider artifact')
  }
  const storageEntry = recomputed.emission.manifest.artifacts.find(
    (entry) => entry.path === SUPABASE_ARTIFACT_PATHS.storagePolicy
  )
  const storageDigest = backendSha256(expectedStorage)
  if (
    storageEntry?.kind !== 'security-policy' ||
    storageEntry.mediaType !== 'application/sql; charset=utf-8' ||
    storageEntry.byteLength !== new TextEncoder().encode(expectedStorage).byteLength ||
    storageEntry.digest !== storageDigest
  ) {
    return invalid('emission Storage artifact is not digest-bound by its manifest')
  }
  return {
    manifestDigest: recomputed.emission.manifestDigest,
    planDigest: planned.plan.planDigest,
    storagePolicySQL: expectedStorage,
    storagePolicyDigest: storageDigest
  }
}

function sourceFile(
  path: string,
  content: string,
  kind: SupabaseSourceMigrationFileV1['kind'],
  mediaType: SupabaseSourceMigrationFileV1['mediaType']
): SupabaseSourceMigrationFileV1 {
  const bytes = new TextEncoder().encode(content)
  return {
    kind,
    path,
    mediaType,
    byteLength: bytes.byteLength,
    digest: backendSha256(bytes),
    content
  }
}

function inspectedSourceLedgerFile(
  ledger: SupabaseInspectedSourceMigrationLedgerV1
): SupabaseSourceMigrationFileV1 {
  const content = canonicalSupabaseInspectedSourceMigrationLedgerJSON(ledger)
  return sourceFile(
    SOURCE_LEDGER_PATH,
    content,
    'inspected-source-ledger',
    'application/json; charset=utf-8'
  )
}

/**
 * Produces source-control artifacts only. This compiler boundary has no filesystem, credential,
 * migration Apply, environment promotion, rollback, or deployment authority.
 */
export async function createSupabaseSourceMigrationBundle(
  input: CreateSupabaseSourceMigrationBundleInputV1
): Promise<SupabaseSourceMigrationBundleV1> {
  const registeredAt = canonicalTimestamp(input.registeredAt)
  const checked = await checkedReview(input.reviewed, input.executionPlan, input.application)
  const emission = checkedEmission(input.reviewed, input.application, input.emission)
  const parsedApplication = parseBackendApplicationSpecV1(input.application)
  if (!parsedApplication.ok) return invalid('application bound to Storage migration is invalid')
  let storageMigrationSQL: string | null
  try {
    storageMigrationSQL = renderSupabaseInspectedStorageMigrationSQL(
      parsedApplication.value,
      input.reviewed.snapshot
    )
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Storage inspected delta failed')
  }
  const verifiedPromotionLedger = await verifySourceMigrationLedgerIntegrity(input.ledger)
  if (!verifiedPromotionLedger.ok) {
    return invalid(
      `promotion ledger failed integrity validation (${verifiedPromotionLedger.diagnostics
        .map((entry) => entry.code)
        .join(', ')})`
    )
  }
  const verifiedSourceLedger = verifySupabaseInspectedSourceMigrationLedgerIntegrity(
    input.sourceLedger
  )
  if (!verifiedSourceLedger.ok)
    return invalid('inspected source ledger failed integrity validation')
  const projectRef = input.reviewed.manifest.inspectionProvenance.projectRef
  if (verifiedSourceLedger.value.ledgerId !== `supabase:${projectRef}:inspected`) {
    return invalid('inspected source ledger belongs to a different Supabase project')
  }
  if (verifiedPromotionLedger.value.ledgerId !== `supabase:${projectRef}:promotion`) {
    return invalid('promotion ledger belongs to a different Supabase project')
  }

  const path = migrationPath(registeredAt, input.name)
  const versionPrefix = migrationVersionPrefix(path)
  if (
    verifiedSourceLedger.value.entries.some(
      (entry) =>
        entry.source.path === path ||
        (entry.source.path.startsWith(versionPrefix) &&
          entry.source.path.charAt(versionPrefix.length) === '_')
    )
  ) {
    return invalid('migration source version already exists')
  }
  const migrationSQL = composeAtomicSupabaseSourceMigrationSQL(
    input.reviewed.sql,
    storageMigrationSQL
  )
  const migration = sourceFile(
    path,
    migrationSQL,
    'migration-sql',
    'application/sql; charset=utf-8'
  )
  if (backendSha256(input.reviewed.sql) !== input.reviewed.manifest.sqlDigest) {
    return invalid('migration review SQL digest differs from the reviewed SQL')
  }

  let executionAuthority: {
    readonly plan: StagedMigrationExecutionPlanV1
    readonly digest: string
  }
  if (checked.executionPlan) {
    if (!checked.executionPlanDigest) return invalid('staged execution plan digest is missing')
    executionAuthority = {
      plan: checked.executionPlan,
      digest: checked.executionPlanDigest
    }
  } else {
    executionAuthority = await ordinaryReviewedExecutionAuthority(
      input.reviewed,
      checked.migrationPlan,
      migration.digest
    )
  }

  const sourceLedger = appendSourceLedgerEntry(verifiedSourceLedger.value, {
    migrationId: input.migrationId,
    name: input.name,
    source: { path: migration.path, digest: migration.digest },
    reviewManifestDigest: input.reviewed.manifestDigest,
    applicationDigest: input.reviewed.manifest.applicationDigest,
    migrationPlanDigest: input.reviewed.manifest.migrationPlanDigest,
    stagedExecutionPlanDigest: executionAuthority.digest,
    emissionManifestDigest: emission.manifestDigest,
    emissionPlanDigest: emission.planDigest,
    storagePolicyArtifactDigest: emission.storagePolicyDigest,
    registeredAt
  })
  const sourceLedgerFile = inspectedSourceLedgerFile(sourceLedger)

  const promotionLedger = await transitionSourceMigrationLedger(verifiedPromotionLedger.value, {
    type: 'register-migration',
    occurredAt: registeredAt,
    entry: {
      migrationId: input.migrationId,
      sequence: verifiedPromotionLedger.value.entries.length + 1,
      name: input.name,
      source: { path: migration.path, digest: migration.digest },
      executionPlan: executionAuthority.plan,
      executionPlanDigest: executionAuthority.digest,
      registeredAt
    }
  })
  const ledgerBytes = canonicalSourceMigrationLedgerBytes(promotionLedger)
  const promotionLedgerFile = sourceFile(
    PROMOTION_LEDGER_PATH,
    new TextDecoder().decode(ledgerBytes),
    'promotion-ledger',
    'application/json; charset=utf-8'
  )

  const manifest = freezeBackendValue({
    format: 'openpencil.supabase-source-migration.v1',
    version: 1,
    providerId: 'supabase',
    environment: 'staging',
    migrationId: input.migrationId,
    sequence: sourceLedger.entries.length,
    reviewManifestDigest: input.reviewed.manifestDigest,
    applicationDigest: input.reviewed.manifest.applicationDigest,
    migrationPlanDigest: input.reviewed.manifest.migrationPlanDigest,
    executionPlanDigest: executionAuthority.digest,
    emissionManifestDigest: emission.manifestDigest,
    emissionPlanDigest: emission.planDigest,
    reviewSqlDigest: input.reviewed.manifest.sqlDigest,
    storagePolicyArtifactDigest: emission.storagePolicyDigest,
    sourceMigration: {
      path: migration.path,
      byteLength: migration.byteLength,
      digest: migration.digest
    },
    inspectedSourceLedger: {
      path: sourceLedgerFile.path,
      byteLength: sourceLedgerFile.byteLength,
      digest: sourceLedgerFile.digest
    },
    promotionLedger: {
      path: promotionLedgerFile.path,
      byteLength: promotionLedgerFile.byteLength,
      digest: promotionLedgerFile.digest
    }
  }) as SupabaseSourceMigrationManifestV1
  return freezeBackendValue({
    manifest,
    manifestDigest: digestCanonicalBackendValue(manifest, '$.supabaseSourceMigration.manifest'),
    files: [migration, sourceLedgerFile, promotionLedgerFile],
    ledger: promotionLedger,
    sourceLedger
  }) as SupabaseSourceMigrationBundleV1
}
