/* oxlint-disable eslint(max-lines) -- The issuer, one-shot lifecycle, and credential sandwich stay together so the same-process trust boundary remains reviewable. */
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { appCredentialServices } from '@/app/settings/credentials/app'
import { withCredentialPersistenceExclusiveGateV1 } from '@/app/settings/credentials/exclusive-gate'
import type { CredentialServices } from '@/app/settings/credentials/services'
import type { CredentialRef, CredentialResolver } from '@/app/settings/credentials/types'

import {
  SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL
} from './credentials'

export const SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_LEASE_ISSUER_FORMAT =
  'openpencil.supabase-management-database-write-credential-lease-issuer.v1' as const
export const SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_LEASE_FORMAT =
  'openpencil.supabase-management-database-write-credential-lease.v1' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_CREDENTIAL_LEASE_PURPOSE =
  'backfill-database-cas-ledger-install' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX =
  'openpencil-install:v1:supabase-backfill-database-cas-ledger:' as const

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SECRET_LIKE_ACCOUNT_ID = /^(?:anon$|service_role$|sbp_|sb_publishable_|sb_secret_)/iu
const JWT_LIKE_ACCOUNT_ID = /^eyJ/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const MAX_PAT_BYTES = 4_096

const ISSUER_KEYS = ['manager', 'resolver'] as const
const RESOLVER_KEYS = ['resolve'] as const
const BINDING_KEYS = [
  'purpose',
  'projectRef',
  'accountId',
  'installReviewDigest',
  'sourceReviewDigest',
  'verificationDigest',
  'ledgerShapeDigest',
  'baseSqlDigest',
  'marker',
  'markerBindingDigest',
  'installSqlDigest',
  'verificationQueryDigest',
  'expectedSharedGrantGeneration'
] as const
const ISSUE_OPTION_KEYS = ['issuer', 'binding'] as const
const CONSUME_OPTION_KEYS = ['issuer', 'lease', 'expectedBinding'] as const
const INSPECT_OPTION_KEYS = ['issuer', 'lease', 'expectedBinding'] as const
const CONSUMED_OPTION_KEYS = ['issuer', 'consumedLease'] as const
const RUN_OPTION_KEYS = ['issuer', 'consumedLease', 'startRequest'] as const

declare const issuerBrand: unique symbol
declare const consumedLeaseBrand: unique symbol

export interface SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1 {
  readonly format: typeof SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_LEASE_ISSUER_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly scope: 'database:write'
  readonly provenance: 'app-vault' | 'testing'
  readonly [issuerBrand]: never
}

export interface SupabaseManagementDatabaseWriteCredentialLeaseBindingV1 {
  readonly purpose: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_CREDENTIAL_LEASE_PURPOSE
  readonly projectRef: string
  readonly accountId: string
  readonly installReviewDigest: string
  readonly sourceReviewDigest: string
  readonly verificationDigest: string
  readonly ledgerShapeDigest: string
  readonly baseSqlDigest: string
  readonly marker: string
  readonly markerBindingDigest: string
  readonly installSqlDigest: string
  readonly verificationQueryDigest: string
  readonly expectedSharedGrantGeneration: string
}

export interface SupabaseManagementDatabaseWriteCredentialLeaseV1 extends SupabaseManagementDatabaseWriteCredentialLeaseBindingV1 {
  readonly format: typeof SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_LEASE_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly scope: 'database:write'
  readonly permission: 'database_migrations_write'
  readonly lifetime: 'single-operation'
  readonly bindingDigest: string
  readonly writeCredentialIncarnation: string
  readonly operationLeaseGeneration: string
}

/**
 * Same-process handle created only after a genuine public lease is consumed. Its enumerable shape is
 * intentionally empty, so cloning or serialization cannot reproduce the private credential context.
 */
export interface SupabaseManagementDatabaseWriteConsumedCredentialLeaseV1 {
  readonly [consumedLeaseBrand]: never
}

export interface IssueSupabaseManagementDatabaseWriteCredentialLeaseOptionsV1 {
  readonly issuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  readonly binding: SupabaseManagementDatabaseWriteCredentialLeaseBindingV1
}

export interface ConsumeSupabaseManagementDatabaseWriteCredentialLeaseOptionsV1 {
  readonly issuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  readonly lease: SupabaseManagementDatabaseWriteCredentialLeaseV1
  readonly expectedBinding: SupabaseManagementDatabaseWriteCredentialLeaseBindingV1
}

export type InspectSupabaseManagementDatabaseWriteCredentialLeaseOptionsV1 =
  ConsumeSupabaseManagementDatabaseWriteCredentialLeaseOptionsV1

/** Secret-free metadata returned only for an exact, still-unconsumed same-process lease identity. */
export interface TrustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1 {
  readonly bindingDigest: string
  readonly writeCredentialIncarnation: string
  readonly operationLeaseGeneration: string
}

export interface SupabaseManagementDatabaseWriteConsumedCredentialLeaseOptionsV1 {
  readonly issuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  readonly consumedLease: SupabaseManagementDatabaseWriteConsumedCredentialLeaseV1
}

export interface RunSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATOptionsV1<
  Result
> extends SupabaseManagementDatabaseWriteConsumedCredentialLeaseOptionsV1 {
  readonly startRequest: (personalAccessToken: string) => Result
}

export type SupabaseManagementDatabaseWriteCredentialLeaseErrorCode =
  | 'supabase-management-database-write-credential-lease-input-invalid'
  | 'supabase-management-database-write-credential-lease-issuer-invalid'
  | 'supabase-management-database-write-credential-lease-binding-invalid'
  | 'supabase-management-database-write-credential-lease-credential-unavailable'
  | 'supabase-management-database-write-credential-lease-credential-not-current'
  | 'supabase-management-database-write-credential-lease-invalid'
  | 'supabase-management-database-write-credential-lease-binding-mismatch'
  | 'supabase-management-database-write-credential-lease-request-start-failed'

export class SupabaseManagementDatabaseWriteCredentialLeaseError extends Error {
  constructor(readonly code: SupabaseManagementDatabaseWriteCredentialLeaseErrorCode) {
    super(`Supabase database-write credential lease failed: ${code}.`)
    this.name = 'SupabaseManagementDatabaseWriteCredentialLeaseError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface TrustedIssuerContextV1 {
  readonly resolve: (reference: CredentialRef) => Promise<string | null>
  readonly provenance: 'app-vault' | 'testing'
}

interface CredentialGenerationWindowV1 {
  readonly sharedGrantGeneration: string
  readonly writeCredentialIncarnation: string
}

interface CredentialWindowPrefixV1 {
  readonly sharedBefore: string | null
  readonly incarnationBefore: string | null
  personalAccessToken: string | null
  readonly incarnationAfter: string | null
}

interface CredentialGenerationPrefixV1 {
  readonly sharedBefore: string | null
  readonly incarnationBefore: string | null
  readonly incarnationAfter: string | null
}

interface TrustedLeaseContextV1 extends CredentialGenerationWindowV1 {
  readonly issuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  readonly lease: SupabaseManagementDatabaseWriteCredentialLeaseV1
  readonly binding: SupabaseManagementDatabaseWriteCredentialLeaseBindingV1
}

interface TrustedConsumedLeaseContextV1 extends TrustedLeaseContextV1 {
  state: 'consumed' | 'running' | 'disposed'
}

const trustedIssuers = new WeakMap<object, TrustedIssuerContextV1>()
const trustedLeases = new WeakMap<object, TrustedLeaseContextV1>()
const consumedLeases = new WeakSet<object>()
const trustedConsumedLeases = new WeakMap<object, TrustedConsumedLeaseContextV1>()

function fail(code: SupabaseManagementDatabaseWriteCredentialLeaseErrorCode): never {
  throw new SupabaseManagementDatabaseWriteCredentialLeaseError(code)
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: SupabaseManagementDatabaseWriteCredentialLeaseErrorCode
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
  try {
    const prototype = Object.getPrototypeOf(value)
    const ownKeys = Reflect.ownKeys(value)
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code)
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code)
    }
  } catch {
    return fail(code)
  }
  return value as UnknownRecord
}

function ownData(record: UnknownRecord, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return fail('supabase-management-database-write-credential-lease-input-invalid')
    }
    return descriptor.value
  } catch {
    return fail('supabase-management-database-write-credential-lease-input-invalid')
  }
}

function requireCloneable(
  value: object,
  code: SupabaseManagementDatabaseWriteCredentialLeaseErrorCode
): void {
  try {
    structuredClone(value)
  } catch {
    fail(code)
  }
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    return fail('supabase-management-database-write-credential-lease-credential-not-current')
  }
  return value
}

function randomUUID(): string {
  if (typeof crypto.randomUUID !== 'function') {
    return fail('supabase-management-database-write-credential-lease-credential-unavailable')
  }
  try {
    const value = crypto.randomUUID()
    if (!UUID_V4.test(value)) {
      return fail('supabase-management-database-write-credential-lease-credential-unavailable')
    }
    return value
  } catch {
    return fail('supabase-management-database-write-credential-lease-credential-unavailable')
  }
}

function projectRef(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_REF.test(value)) {
    return fail('supabase-management-database-write-credential-lease-binding-invalid')
  }
  return value
}

function accountId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !STABLE_ID.test(value) ||
    SECRET_LIKE_ACCOUNT_ID.test(value) ||
    JWT_LIKE_ACCOUNT_ID.test(value)
  ) {
    return fail('supabase-management-database-write-credential-lease-binding-invalid')
  }
  return value
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    return fail('supabase-management-database-write-credential-lease-binding-invalid')
  }
  return value
}

function installMarker(value: unknown, markerBindingDigest: string): string {
  const expected = `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}${markerBindingDigest}`
  if (value !== expected) {
    return fail('supabase-management-database-write-credential-lease-binding-invalid')
  }
  return expected
}

function expectedSharedGrantGeneration(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    return fail('supabase-management-database-write-credential-lease-binding-invalid')
  }
  return value
}

function bindingSnapshot(value: unknown): SupabaseManagementDatabaseWriteCredentialLeaseBindingV1 {
  const source = exactRecord(
    value,
    BINDING_KEYS,
    'supabase-management-database-write-credential-lease-binding-invalid'
  )
  requireCloneable(source, 'supabase-management-database-write-credential-lease-binding-invalid')
  const purpose = ownData(source, 'purpose')
  if (purpose !== SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_CREDENTIAL_LEASE_PURPOSE) {
    return fail('supabase-management-database-write-credential-lease-binding-invalid')
  }
  const markerBindingDigest = digest(ownData(source, 'markerBindingDigest'))
  return Object.freeze({
    purpose,
    projectRef: projectRef(ownData(source, 'projectRef')),
    accountId: accountId(ownData(source, 'accountId')),
    installReviewDigest: digest(ownData(source, 'installReviewDigest')),
    sourceReviewDigest: digest(ownData(source, 'sourceReviewDigest')),
    verificationDigest: digest(ownData(source, 'verificationDigest')),
    ledgerShapeDigest: digest(ownData(source, 'ledgerShapeDigest')),
    baseSqlDigest: digest(ownData(source, 'baseSqlDigest')),
    marker: installMarker(ownData(source, 'marker'), markerBindingDigest),
    markerBindingDigest,
    installSqlDigest: digest(ownData(source, 'installSqlDigest')),
    verificationQueryDigest: digest(ownData(source, 'verificationQueryDigest')),
    expectedSharedGrantGeneration: expectedSharedGrantGeneration(
      ownData(source, 'expectedSharedGrantGeneration')
    )
  })
}

function sameBinding(
  left: SupabaseManagementDatabaseWriteCredentialLeaseBindingV1,
  right: SupabaseManagementDatabaseWriteCredentialLeaseBindingV1
): boolean {
  return BINDING_KEYS.every((key) => left[key] === right[key])
}

function issuerContext(value: unknown): Readonly<{
  issuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  context: TrustedIssuerContextV1
}> {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-management-database-write-credential-lease-issuer-invalid')
  }
  const context = trustedIssuers.get(value)
  if (!context) return fail('supabase-management-database-write-credential-lease-issuer-invalid')
  return Object.freeze({
    issuer: value as SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
    context
  })
}

function validPAT(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    new TextEncoder().encode(value).byteLength <= MAX_PAT_BYTES &&
    !/\p{Cc}/u.test(value)
  )
}

async function readCredential(
  issuer: TrustedIssuerContextV1,
  reference: CredentialRef
): Promise<string | null> {
  try {
    const value = await issuer.resolve(reference)
    if (value !== null && typeof value !== 'string') {
      return fail('supabase-management-database-write-credential-lease-credential-unavailable')
    }
    return value
  } catch (cause) {
    if (cause instanceof SupabaseManagementDatabaseWriteCredentialLeaseError) throw cause
    return fail('supabase-management-database-write-credential-lease-credential-unavailable')
  }
}

function credentialValue(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    return fail('supabase-management-database-write-credential-lease-credential-unavailable')
  }
  return value
}

function validateCredentialGenerationWindow(
  sharedBefore: string | null,
  incarnationBefore: string | null,
  incarnationAfter: string | null,
  sharedAfter: string | null,
  expectedSharedGeneration: string,
  expectedWriteCredentialIncarnation?: string
): CredentialGenerationWindowV1 {
  const shared = uuid(sharedBefore)
  const incarnation = uuid(incarnationBefore)
  if (
    shared !== sharedAfter ||
    incarnation !== incarnationAfter ||
    shared === incarnation ||
    shared !== expectedSharedGeneration ||
    (expectedWriteCredentialIncarnation !== undefined &&
      incarnation !== expectedWriteCredentialIncarnation)
  ) {
    return fail('supabase-management-database-write-credential-lease-credential-not-current')
  }
  return Object.freeze({
    sharedGrantGeneration: shared,
    writeCredentialIncarnation: incarnation
  })
}

function validateCurrentCredentialWindow(
  prefix: CredentialWindowPrefixV1,
  sharedAfter: string | null,
  expected: TrustedConsumedLeaseContextV1
): string {
  validateCredentialGenerationWindow(
    prefix.sharedBefore,
    prefix.incarnationBefore,
    prefix.incarnationAfter,
    sharedAfter,
    expected.sharedGrantGeneration,
    expected.writeCredentialIncarnation
  )
  if (!validPAT(prefix.personalAccessToken)) {
    return fail('supabase-management-database-write-credential-lease-credential-not-current')
  }
  return prefix.personalAccessToken
}

async function readCredentialGenerationPrefix(
  issuer: TrustedIssuerContextV1
): Promise<CredentialGenerationPrefixV1> {
  const sharedBefore = await readCredential(issuer, SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)
  const incarnationBefore = await readCredential(
    issuer,
    SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL
  )
  const incarnationAfter = await readCredential(
    issuer,
    SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL
  )
  return Object.freeze({ sharedBefore, incarnationBefore, incarnationAfter })
}

async function readCredentialWindowPrefix(
  issuer: TrustedIssuerContextV1
): Promise<CredentialWindowPrefixV1> {
  const sharedBefore = await readCredential(issuer, SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)
  const incarnationBefore = await readCredential(
    issuer,
    SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL
  )
  const personalAccessToken = await readCredential(
    issuer,
    SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL
  )
  const incarnationAfter = await readCredential(
    issuer,
    SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL
  )
  return {
    sharedBefore,
    incarnationBefore,
    personalAccessToken,
    incarnationAfter
  }
}

function captureResolver(
  services: CredentialServices,
  provenance: TrustedIssuerContextV1['provenance']
): TrustedIssuerContextV1 {
  const source = exactRecord(
    services,
    ISSUER_KEYS,
    'supabase-management-database-write-credential-lease-issuer-invalid'
  )
  const resolverValue = ownData(source, 'resolver')
  const resolver = exactRecord(
    resolverValue,
    RESOLVER_KEYS,
    'supabase-management-database-write-credential-lease-issuer-invalid'
  )
  const resolve = ownData(resolver, 'resolve')
  if (typeof resolve !== 'function') {
    return fail('supabase-management-database-write-credential-lease-issuer-invalid')
  }
  return Object.freeze({
    provenance,
    resolve(reference: CredentialRef): Promise<string | null> {
      return Reflect.apply(resolve as CredentialResolver['resolve'], resolverValue, [reference])
    }
  })
}

function createIssuer(
  services: CredentialServices,
  provenance: TrustedIssuerContextV1['provenance']
): SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1 {
  const context = captureResolver(services, provenance)
  const issuer = Object.freeze({
    format: SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_LEASE_ISSUER_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    scope: 'database:write' as const,
    provenance
  }) as SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  trustedIssuers.set(issuer, context)
  return issuer
}

/** Testing-only issuer. Production transports must reject it using the singleton predicate below. */
export function createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(
  services: CredentialServices
): SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1 {
  return createIssuer(services, 'testing')
}

/** Exact production singleton bound once to the application credential resolver. */
export const appSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1 = createIssuer(
  appCredentialServices,
  'app-vault'
)

/** Production transports must accept only this exact app-vault identity, never public metadata. */
export function isAppVaultSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1(
  value: unknown
): value is SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1 {
  return (
    value === appSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1 &&
    trustedIssuers.get(value)?.provenance === 'app-vault'
  )
}

/** Exact predicate for testing compositions; structural clones cannot issue or consume leases. */
export function isTestingSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1(
  value: unknown
): value is SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    trustedIssuers.get(value)?.provenance === 'testing'
  )
}

/**
 * Issue secret-free public metadata backed by an exact same-process WeakMap capability. The
 * operation generation is sampled before credential reads; after the final shared-generation read,
 * validation and registration are synchronous.
 */
export async function issueSupabaseManagementDatabaseWriteCredentialLeaseV1(
  input: IssueSupabaseManagementDatabaseWriteCredentialLeaseOptionsV1
): Promise<SupabaseManagementDatabaseWriteCredentialLeaseV1> {
  const source = exactRecord(
    input,
    ISSUE_OPTION_KEYS,
    'supabase-management-database-write-credential-lease-input-invalid'
  )
  const issuer = issuerContext(ownData(source, 'issuer'))
  const binding = bindingSnapshot(ownData(source, 'binding'))
  requireCloneable(source, 'supabase-management-database-write-credential-lease-input-invalid')
  const operationLeaseGeneration = randomUUID()
  const bindingDigest = await digestCanonicalManifest(binding)
  const prefix = await readCredentialGenerationPrefix(issuer.context)
  let sharedAfter: string | null
  try {
    sharedAfter = credentialValue(
      await issuer.context.resolve(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)
    )
  } catch (cause) {
    if (cause instanceof SupabaseManagementDatabaseWriteCredentialLeaseError) throw cause
    return fail('supabase-management-database-write-credential-lease-credential-unavailable')
  }
  // No asynchronous boundary may follow this final resolver await: validate and register the exact
  // credential window synchronously so another rotation cannot be hidden before WeakMap minting.
  const credential = validateCredentialGenerationWindow(
    prefix.sharedBefore,
    prefix.incarnationBefore,
    prefix.incarnationAfter,
    sharedAfter,
    binding.expectedSharedGrantGeneration
  )
  const lease = Object.freeze({
    format: SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_LEASE_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    scope: 'database:write' as const,
    permission: 'database_migrations_write' as const,
    lifetime: 'single-operation' as const,
    bindingDigest,
    ...binding,
    writeCredentialIncarnation: credential.writeCredentialIncarnation,
    operationLeaseGeneration
  }) satisfies SupabaseManagementDatabaseWriteCredentialLeaseV1
  trustedLeases.set(
    lease,
    Object.freeze({
      issuer: issuer.issuer,
      lease,
      binding,
      ...credential
    })
  )
  return lease
}

/**
 * Inspect one exact unconsumed lease without resolving a PAT or consuming the final request right.
 * Clones, structural forgeries, wrong issuers, and binding drift return null.
 */
export function trustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1(
  input: InspectSupabaseManagementDatabaseWriteCredentialLeaseOptionsV1
): TrustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1 | null {
  try {
    const source = exactRecord(
      input,
      INSPECT_OPTION_KEYS,
      'supabase-management-database-write-credential-lease-input-invalid'
    )
    const issuer = issuerContext(ownData(source, 'issuer'))
    const leaseValue = ownData(source, 'lease')
    const expectedBinding = bindingSnapshot(ownData(source, 'expectedBinding'))
    requireCloneable(source, 'supabase-management-database-write-credential-lease-input-invalid')
    if (leaseValue === null || typeof leaseValue !== 'object' || consumedLeases.has(leaseValue)) {
      return null
    }
    const trusted = trustedLeases.get(leaseValue)
    if (
      !trusted ||
      trusted.issuer !== issuer.issuer ||
      trusted.lease !== leaseValue ||
      !sameBinding(trusted.binding, expectedBinding)
    ) {
      return null
    }
    return Object.freeze({
      bindingDigest: trusted.lease.bindingDigest,
      writeCredentialIncarnation: trusted.lease.writeCredentialIncarnation,
      operationLeaseGeneration: trusted.lease.operationLeaseGeneration
    })
  } catch {
    return null
  }
}

function opaqueConsumedLease(): SupabaseManagementDatabaseWriteConsumedCredentialLeaseV1 {
  return Object.freeze(
    Object.create(null)
  ) as SupabaseManagementDatabaseWriteConsumedCredentialLeaseV1
}

/** Consume one exact public lease and its exact binding before the first subsequent await. */
export function consumeSupabaseManagementDatabaseWriteCredentialLeaseV1(
  input: ConsumeSupabaseManagementDatabaseWriteCredentialLeaseOptionsV1
): SupabaseManagementDatabaseWriteConsumedCredentialLeaseV1 {
  const source = exactRecord(
    input,
    CONSUME_OPTION_KEYS,
    'supabase-management-database-write-credential-lease-input-invalid'
  )
  const issuer = issuerContext(ownData(source, 'issuer'))
  const leaseValue = ownData(source, 'lease')
  const expectedBinding = bindingSnapshot(ownData(source, 'expectedBinding'))
  requireCloneable(source, 'supabase-management-database-write-credential-lease-input-invalid')
  if (leaseValue === null || typeof leaseValue !== 'object' || consumedLeases.has(leaseValue)) {
    return fail('supabase-management-database-write-credential-lease-invalid')
  }
  const trusted = trustedLeases.get(leaseValue)
  if (!trusted) return fail('supabase-management-database-write-credential-lease-invalid')

  // Burn first so binding checks cannot be raced or retried after a failed consumption attempt.
  trustedLeases.delete(leaseValue)
  consumedLeases.add(leaseValue)
  if (
    trusted.issuer !== issuer.issuer ||
    trusted.lease !== leaseValue ||
    !sameBinding(trusted.binding, expectedBinding)
  ) {
    return fail('supabase-management-database-write-credential-lease-binding-mismatch')
  }

  const consumed = opaqueConsumedLease()
  trustedConsumedLeases.set(consumed, {
    ...trusted,
    state: 'consumed'
  })
  return consumed
}

function consumedOptions(
  input: SupabaseManagementDatabaseWriteConsumedCredentialLeaseOptionsV1
): Readonly<{
  issuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  issuerContext: TrustedIssuerContextV1
  consumedLease: SupabaseManagementDatabaseWriteConsumedCredentialLeaseV1
  context: TrustedConsumedLeaseContextV1
}> {
  const source = exactRecord(
    input,
    CONSUMED_OPTION_KEYS,
    'supabase-management-database-write-credential-lease-input-invalid'
  )
  const issuer = issuerContext(ownData(source, 'issuer'))
  const consumedLease = ownData(source, 'consumedLease')
  requireCloneable(source, 'supabase-management-database-write-credential-lease-input-invalid')
  if (consumedLease === null || typeof consumedLease !== 'object') {
    return fail('supabase-management-database-write-credential-lease-invalid')
  }
  const context = trustedConsumedLeases.get(consumedLease)
  if (!context || context.issuer !== issuer.issuer) {
    if (context) discardConsumedLease(consumedLease, context)
    return fail('supabase-management-database-write-credential-lease-invalid')
  }
  return Object.freeze({
    issuer: issuer.issuer,
    issuerContext: issuer.context,
    consumedLease: consumedLease as SupabaseManagementDatabaseWriteConsumedCredentialLeaseV1,
    context
  })
}

function discardConsumedLease(value: object, context: TrustedConsumedLeaseContextV1): void {
  context.state = 'disposed'
  trustedConsumedLeases.delete(value)
}

/**
 * Host-only request-start boundary. It burns the consumed lease before the first await, resolves
 * the PAT only in this final credential window, then invokes the starter synchronously after the
 * final shared-generation read. The module drops every PAT reference before adopting the result.
 * Production transports must additionally require the exact app-vault issuer singleton.
 */
export async function runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1<Result>(
  input: RunSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATOptionsV1<Result>
): Promise<Awaited<Result>> {
  const source = exactRecord(
    input,
    RUN_OPTION_KEYS,
    'supabase-management-database-write-credential-lease-input-invalid'
  )
  const issuer = issuerContext(ownData(source, 'issuer'))
  const consumedLease = ownData(source, 'consumedLease')
  const startRequest = ownData(source, 'startRequest')
  if (
    consumedLease === null ||
    typeof consumedLease !== 'object' ||
    typeof startRequest !== 'function'
  ) {
    return fail('supabase-management-database-write-credential-lease-invalid')
  }
  const context = trustedConsumedLeases.get(consumedLease)
  if (!context || context.issuer !== issuer.issuer || context.state !== 'consumed') {
    if (context) discardConsumedLease(consumedLease, context)
    return fail('supabase-management-database-write-credential-lease-invalid')
  }

  // Burn before the first await so concurrent/replayed calls can never start a second request.
  context.state = 'running'
  trustedConsumedLeases.delete(consumedLease)
  let started: Readonly<{ started: Result }>
  try {
    started = await withCredentialPersistenceExclusiveGateV1<Result>(async () => {
      let prefix: CredentialWindowPrefixV1 | null = null
      let personalAccessToken: string | null = null
      try {
        prefix = await readCredentialWindowPrefix(issuer.context)
        const sharedAfter = credentialValue(
          await issuer.context.resolve(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)
        )
        personalAccessToken = validateCurrentCredentialWindow(prefix, sharedAfter, context)
        try {
          return Object.freeze({
            started: Reflect.apply(startRequest, undefined, [personalAccessToken]) as Result
          })
        } catch {
          return fail('supabase-management-database-write-credential-lease-request-start-failed')
        }
      } finally {
        personalAccessToken = null
        if (prefix) prefix.personalAccessToken = null
        context.state = 'disposed'
      }
    })
  } catch (cause) {
    if (cause instanceof SupabaseManagementDatabaseWriteCredentialLeaseError) throw cause
    return fail('supabase-management-database-write-credential-lease-credential-unavailable')
  }

  // The shared credential gate is already released and local PAT references are cleared before
  // adopting the possibly asynchronous request result. Remote failures are always static here.
  try {
    return await started.started
  } catch {
    return fail('supabase-management-database-write-credential-lease-request-start-failed')
  }
}

/** Drop an unused consumed handle; no PAT is resolved or retained by this cleanup path. */
export function disposeSupabaseManagementDatabaseWriteCredentialLeaseV1(
  input: SupabaseManagementDatabaseWriteConsumedCredentialLeaseOptionsV1
): boolean {
  let parsed: ReturnType<typeof consumedOptions>
  try {
    parsed = consumedOptions(input)
  } catch (cause) {
    if (
      cause instanceof SupabaseManagementDatabaseWriteCredentialLeaseError &&
      cause.code === 'supabase-management-database-write-credential-lease-invalid'
    ) {
      return false
    }
    throw cause
  }
  discardConsumedLease(parsed.consumedLease, parsed.context)
  return true
}
