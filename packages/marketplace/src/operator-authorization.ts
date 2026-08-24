import { parseSha256Base64URL } from '@open-pencil/scene-graph'

import { parseMarketplaceTimestamp } from './types'

export const MARKETPLACE_OPERATOR_ROLES = Object.freeze([
  'reviewer',
  'releaser',
  'security_admin',
  'super_admin'
] as const)

export type MarketplaceOperatorRole = (typeof MARKETPLACE_OPERATOR_ROLES)[number]

export const MARKETPLACE_OPERATOR_READ_OPERATIONS = Object.freeze([
  'operator.overview.read',
  'operator.publishers.read',
  'operator.publisher.read',
  'operator.publisher-keys.read',
  'operator.publisher-key.read',
  'operator.ownerships.read',
  'operator.ownership.read',
  'operator.submissions.read',
  'operator.submission.read',
  'operator.submission.presentation.read',
  'operator.submission.revision-diff.read',
  'operator.submission.current-check-report.read',
  'operator.submission.reviewer-history.read',
  'operator.releases.read',
  'operator.release.read',
  'operator.publications.read',
  'operator.publication.read',
  'operator.audit.read',
  'operator.audit-event.read'
] as const)

export const MARKETPLACE_OPERATOR_PREVIEW_OPERATION = 'operator.impact.preview' as const

export const MARKETPLACE_OPERATOR_ACTION_OPERATIONS = Object.freeze([
  'publisher.approve',
  'publisher.reject',
  'publisher.suspend',
  'publisher.reactivate',
  'publisher-key.approve',
  'publisher-key.reject',
  'publisher-key.revoke',
  'ownership.approve',
  'ownership.reject',
  'submission.approve',
  'submission.request-changes',
  'submission.reject',
  'release.publish',
  'release.yank',
  'publication.publish'
] as const)

export type MarketplaceOperatorReadOperation = (typeof MARKETPLACE_OPERATOR_READ_OPERATIONS)[number]
export type MarketplaceOperatorActionOperation =
  (typeof MARKETPLACE_OPERATOR_ACTION_OPERATIONS)[number]
export type MarketplaceOperatorOperation =
  | MarketplaceOperatorReadOperation
  | typeof MARKETPLACE_OPERATOR_PREVIEW_OPERATION
  | MarketplaceOperatorActionOperation

export interface MarketplaceOperatorStepUpV2 {
  verifiedAt: string
  grantIdDigest: string
}

export interface MarketplaceOperatorAuthorizationV2 {
  realm: 'platform'
  role: MarketplaceOperatorRole
  operation: MarketplaceOperatorOperation
  mfaVerifiedAt: string
  stepUp: MarketplaceOperatorStepUpV2 | null
}

export interface MarketplaceOperatorOperationPolicy {
  readonly roles: readonly MarketplaceOperatorRole[]
  readonly requiresStepUp: boolean
}

export const MARKETPLACE_OPERATOR_AUTHORIZATION_LIMITS = Object.freeze({
  maxMfaAgeMs: 10 * 60_000,
  maxStepUpAgeMs: 2 * 60_000,
  maxFutureSkewMs: 60_000
})

const ALL_ROLES = MARKETPLACE_OPERATOR_ROLES
const REVIEW_ROLES = Object.freeze(['reviewer', 'super_admin'] as const)
const RELEASE_ROLES = Object.freeze(['releaser', 'super_admin'] as const)
const SECURITY_ROLES = Object.freeze(['security_admin', 'super_admin'] as const)
const SUPER_ADMIN_ONLY = Object.freeze(['super_admin'] as const)

export const MARKETPLACE_OPERATOR_OPERATION_POLICY = Object.freeze({
  'operator.overview.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.publishers.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.publisher.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.publisher-keys.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.publisher-key.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.ownerships.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.ownership.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.submissions.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.submission.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.submission.presentation.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.submission.revision-diff.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.submission.current-check-report.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.submission.reviewer-history.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.releases.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.release.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.publications.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.publication.read': { roles: ALL_ROLES, requiresStepUp: false },
  'operator.audit.read': { roles: SECURITY_ROLES, requiresStepUp: false },
  'operator.audit-event.read': { roles: SECURITY_ROLES, requiresStepUp: false },
  'operator.impact.preview': { roles: ALL_ROLES, requiresStepUp: false },
  'publisher.approve': { roles: REVIEW_ROLES, requiresStepUp: false },
  'publisher.reject': { roles: REVIEW_ROLES, requiresStepUp: true },
  'publisher.suspend': { roles: SECURITY_ROLES, requiresStepUp: true },
  'publisher.reactivate': { roles: SECURITY_ROLES, requiresStepUp: true },
  'publisher-key.approve': { roles: REVIEW_ROLES, requiresStepUp: false },
  'publisher-key.reject': { roles: REVIEW_ROLES, requiresStepUp: true },
  'publisher-key.revoke': { roles: SECURITY_ROLES, requiresStepUp: true },
  'ownership.approve': { roles: REVIEW_ROLES, requiresStepUp: false },
  'ownership.reject': { roles: REVIEW_ROLES, requiresStepUp: true },
  'submission.approve': { roles: REVIEW_ROLES, requiresStepUp: false },
  'submission.request-changes': { roles: REVIEW_ROLES, requiresStepUp: false },
  'submission.reject': { roles: REVIEW_ROLES, requiresStepUp: true },
  'release.publish': { roles: RELEASE_ROLES, requiresStepUp: true },
  'release.yank': { roles: RELEASE_ROLES, requiresStepUp: true },
  'publication.publish': { roles: SUPER_ADMIN_ONLY, requiresStepUp: true }
} satisfies Readonly<Record<MarketplaceOperatorOperation, MarketplaceOperatorOperationPolicy>>)

const ROLE_SET = new Set<string>(MARKETPLACE_OPERATOR_ROLES)
const OPERATION_SET = new Set<string>([
  ...MARKETPLACE_OPERATOR_READ_OPERATIONS,
  MARKETPLACE_OPERATOR_PREVIEW_OPERATION,
  ...MARKETPLACE_OPERATOR_ACTION_OPERATIONS
])
const ACTION_OPERATION_SET = new Set<string>(MARKETPLACE_OPERATOR_ACTION_OPERATIONS)
const AUTHORIZATION_KEYS = Object.freeze([
  'realm',
  'role',
  'operation',
  'mfaVerifiedAt',
  'stepUp'
] as const)
const STEP_UP_KEYS = Object.freeze(['verifiedAt', 'grantIdDigest'] as const)

interface MarketplaceOperatorRecord {
  [key: string]: unknown
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[]
): MarketplaceOperatorRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  const names = Object.getOwnPropertyNames(value)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    names.length !== keys.length ||
    names.some((name, index) => name !== keys[index]) ||
    names.some((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      return !descriptor || !('value' in descriptor) || !descriptor.enumerable
    })
  ) {
    throw new TypeError(`${path} fields are not canonical`)
  }
  return value as MarketplaceOperatorRecord
}

function role(value: unknown, path: string): MarketplaceOperatorRole {
  if (typeof value !== 'string' || !ROLE_SET.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as MarketplaceOperatorRole
}

function operation(value: unknown, path: string): MarketplaceOperatorOperation {
  if (typeof value !== 'string' || !OPERATION_SET.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as MarketplaceOperatorOperation
}

function parseStepUp(value: unknown, path: string): MarketplaceOperatorStepUpV2 | null {
  if (value === null) return null
  const source = exactRecord(value, path, STEP_UP_KEYS)
  return Object.freeze({
    verifiedAt: parseMarketplaceTimestamp(source.verifiedAt, `${path}.verifiedAt`),
    grantIdDigest: parseSha256Base64URL(source.grantIdDigest, `${path}.grantIdDigest`)
  })
}

export function parseMarketplaceOperatorAuthorization(
  value: unknown,
  path = 'Marketplace operator authorization'
): MarketplaceOperatorAuthorizationV2 {
  const source = exactRecord(value, path, AUTHORIZATION_KEYS)
  if (source.realm !== 'platform') throw new TypeError(`${path}.realm is not supported`)
  return Object.freeze({
    realm: 'platform',
    role: role(source.role, `${path}.role`),
    operation: operation(source.operation, `${path}.operation`),
    mfaVerifiedAt: parseMarketplaceTimestamp(source.mfaVerifiedAt, `${path}.mfaVerifiedAt`),
    stepUp: parseStepUp(source.stepUp, `${path}.stepUp`)
  })
}

function assertNotAfter(timestamp: string, ceiling: number, path: string): void {
  const verifiedAt = Date.parse(timestamp)
  if (verifiedAt > ceiling) {
    throw new Error(`${path} is later than the operator assertion`)
  }
}

function assertFresh(timestamp: string, ceiling: number, maximumAge: number, path: string): void {
  const verifiedAt = Date.parse(timestamp)
  assertNotAfter(timestamp, ceiling, path)
  if (ceiling - verifiedAt > maximumAge) {
    throw new Error(`${path} is outside the allowed freshness window`)
  }
}

export interface MarketplaceOperatorAuthorizationCheck {
  readonly assertionTimestamp: string
  readonly now?: number
}

export function assertMarketplaceOperatorAuthorization(
  authorizationValue: unknown,
  expectedOperation: MarketplaceOperatorOperation,
  check: MarketplaceOperatorAuthorizationCheck
): MarketplaceOperatorAuthorizationV2 {
  const now = check.now ?? Date.now()
  if (!Number.isSafeInteger(now)) throw new TypeError('Marketplace operator time is invalid')
  const assertionTimestamp = parseMarketplaceTimestamp(
    check.assertionTimestamp,
    'Marketplace operator assertion timestamp'
  )
  const assertedAt = Date.parse(assertionTimestamp)
  if (assertedAt > now) {
    throw new Error('Marketplace operator assertion timestamp must not be in the future')
  }
  if (now - assertedAt > MARKETPLACE_OPERATOR_AUTHORIZATION_LIMITS.maxFutureSkewMs) {
    throw new Error('Marketplace operator assertion timestamp is outside the active request window')
  }
  const authorization = parseMarketplaceOperatorAuthorization(authorizationValue)
  if (authorization.operation !== expectedOperation) {
    throw new Error('Marketplace operator operation does not match the route')
  }
  const policy = MARKETPLACE_OPERATOR_OPERATION_POLICY[expectedOperation]
  if (!(policy.roles as readonly MarketplaceOperatorRole[]).includes(authorization.role)) {
    throw new Error('Marketplace operator role is not authorized for the operation')
  }
  assertNotAfter(authorization.mfaVerifiedAt, assertedAt, 'Marketplace operator MFA')
  if (ACTION_OPERATION_SET.has(expectedOperation)) {
    assertFresh(
      authorization.mfaVerifiedAt,
      assertedAt,
      MARKETPLACE_OPERATOR_AUTHORIZATION_LIMITS.maxMfaAgeMs,
      'Marketplace operator MFA'
    )
    assertFresh(
      authorization.mfaVerifiedAt,
      now,
      MARKETPLACE_OPERATOR_AUTHORIZATION_LIMITS.maxMfaAgeMs,
      'Marketplace operator MFA'
    )
  }
  if (policy.requiresStepUp) {
    if (!authorization.stepUp) {
      throw new Error('Marketplace operator step-up is required for the operation')
    }
    assertFresh(
      authorization.stepUp.verifiedAt,
      assertedAt,
      MARKETPLACE_OPERATOR_AUTHORIZATION_LIMITS.maxStepUpAgeMs,
      'Marketplace operator step-up'
    )
    assertFresh(
      authorization.stepUp.verifiedAt,
      now,
      MARKETPLACE_OPERATOR_AUTHORIZATION_LIMITS.maxStepUpAgeMs,
      'Marketplace operator step-up'
    )
  } else if (authorization.stepUp !== null) {
    throw new Error('Marketplace operator step-up is not accepted for this operation')
  }
  return authorization
}

export function assertMarketplaceOperatorImpactPreviewAuthorization(
  authorizationValue: unknown,
  prospectiveOperation: MarketplaceOperatorActionOperation,
  check: MarketplaceOperatorAuthorizationCheck
): MarketplaceOperatorAuthorizationV2 {
  const authorization = assertMarketplaceOperatorAuthorization(
    authorizationValue,
    MARKETPLACE_OPERATOR_PREVIEW_OPERATION,
    check
  )
  const prospectivePolicy = MARKETPLACE_OPERATOR_OPERATION_POLICY[prospectiveOperation]
  if (
    !(prospectivePolicy.roles as readonly MarketplaceOperatorRole[]).includes(authorization.role)
  ) {
    throw new Error('Marketplace operator role cannot preview the prospective operation')
  }
  return authorization
}
