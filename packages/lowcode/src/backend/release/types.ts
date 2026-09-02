import type { BackendCredentialRef, MigrationPlan } from '../types'

export const BACKEND_RELEASE_PLAN_VERSION = 1 as const
export const BACKEND_RELEASE_RECEIPT_VERSION = 1 as const
export const BACKEND_RELEASE_STATE_VERSION = 1 as const

export type BackendReleaseEnvironment = 'preview' | 'staging' | 'production'

export type BackendReleasePhase =
  | 'inspect'
  | 'plan'
  | 'emit'
  | 'review'
  | 'confirm'
  | 'apply'
  | 'verify'
  | 'receipt'

export type BackendReleaseOutcome =
  | 'pending'
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'outcome-unknown'

export type BackendReleaseDispatchState = 'not-dispatched' | 'dispatched' | 'settled'

/**
 * Serializable snapshot of the exact host-reviewed provider contribution used by a plan.
 * This is authority evidence only. It cannot carry an executor, endpoint, or credential.
 */
export interface BackendReleaseProviderAuthorityV1 {
  readonly publisherId: string
  readonly packageDigest: string
  readonly pluginId: string
  readonly contributionId: string
  readonly providerId: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly contractVersion: number
  readonly supportedModelVersions: readonly number[]
  readonly capabilities: readonly string[]
  readonly permissions: readonly string[]
  readonly outputKinds: readonly string[]
}

/** Values that must still match a fresh host Inspect immediately before Apply. */
export interface BackendReleaseAuthorityV1 {
  readonly documentDigest: string
  readonly irDigest: string
  readonly inspectedSchemaDigest: string
  readonly compilerVersion: string
  readonly target: string
  readonly environment: BackendReleaseEnvironment
  readonly projectId: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly backendProvider: BackendReleaseProviderAuthorityV1
}

export interface BackendReleaseApplySnapshotV1 {
  readonly planDigest: string
  readonly authority: BackendReleaseAuthorityV1
}

export type BackendReleaseStaleField =
  | 'planDigest'
  | 'planIntegrity'
  | 'documentDigest'
  | 'irDigest'
  | 'schemaDigest'
  | 'compilerVersion'
  | 'target'
  | 'environment'
  | 'projectId'
  | 'accountId'
  | 'grantGeneration'
  | 'publisherId'
  | 'packageDigest'
  | 'pluginId'
  | 'contributionId'
  | 'providerId'
  | 'adapterId'
  | 'adapterVersion'
  | 'contractVersion'
  | 'supportedModelVersions'
  | 'capabilities'
  | 'permissions'
  | 'outputKinds'

export interface BackendReleaseStalenessIssue {
  readonly field: BackendReleaseStaleField
  readonly code: 'release-plan-integrity-invalid' | 'release-plan-stale'
  readonly message: string
}

export interface BackendReleaseFreshnessResult {
  readonly stale: boolean
  readonly issues: readonly BackendReleaseStalenessIssue[]
}

export interface BackendReleaseMigrationOperationV1 {
  readonly operationId: string
  readonly kind: string
  readonly risk: 'low' | 'medium' | 'high' | 'destructive'
  readonly checksum: string
  readonly reason: string
}

export interface BackendReleaseMigrationBindingV1 {
  readonly planId: string
  readonly planDigest: string
  readonly fromModelDigest: string | null
  readonly targetModelDigest: string
  readonly highestRisk: 'low' | 'medium' | 'high' | 'destructive'
  readonly requiresBackup: boolean
  readonly operations: readonly BackendReleaseMigrationOperationV1[]
}

export type BackendReleaseArtifactKind = 'static' | 'server' | 'schema'

export interface BackendReleasePlanPayloadV1 {
  readonly format: 'openpencil.backend-release-plan'
  readonly version: typeof BACKEND_RELEASE_PLAN_VERSION
  readonly planId: string
  readonly authority: BackendReleaseAuthorityV1
  readonly migration: BackendReleaseMigrationBindingV1
  readonly requiredArtifactKinds: readonly BackendReleaseArtifactKind[]
  readonly requiredEnvironmentNames: readonly string[]
  readonly requiredCredentialRefs: readonly BackendCredentialRef[]
}

export interface BackendReleasePlanV1 extends BackendReleasePlanPayloadV1 {
  readonly planDigest: string
}

declare const verifiedBackendReleasePlanBrand: unique symbol

/** A digest-verified, deeply frozen plan accepted by the pure reducer. */
export type VerifiedBackendReleasePlanV1 = BackendReleasePlanV1 & {
  readonly [verifiedBackendReleasePlanBrand]: true
}

export interface CreateBackendReleasePlanInput {
  readonly planId: string
  readonly authority: BackendReleaseAuthorityV1
  readonly migrationPlan: MigrationPlan
  readonly requiredArtifactKinds: readonly BackendReleaseArtifactKind[]
  readonly requiredEnvironmentNames?: readonly string[]
  readonly requiredCredentialRefs?: readonly BackendCredentialRef[]
}

export interface BackendReleaseDestructiveConfirmationV1 {
  readonly planDigest: string
  readonly operationId: string
  readonly confirmed: true
  readonly backendProviderId: string
  readonly backupDescription: string
  readonly providerRecoveryDescription: string
  readonly confirmedAt: string
}

export interface BackendReleaseConfirmationBlocker {
  readonly operationId: string
  readonly code:
    | 'destructive-confirmation-missing'
    | 'destructive-confirmation-duplicate'
    | 'destructive-confirmation-plan-mismatch'
    | 'destructive-confirmation-provider-mismatch'
    | 'destructive-confirmation-unexpected'
    | 'destructive-confirmation-invalid'
    | 'destructive-backup-description-required'
    | 'destructive-provider-recovery-required'
  readonly message: string
}

export interface BackendReleaseConfirmationReadiness {
  readonly ready: boolean
  readonly blockers: readonly BackendReleaseConfirmationBlocker[]
}

export const BACKEND_PRODUCTION_GATE_IDS = [
  'migration-applied',
  'schema-drift-none',
  'auth-policy-verified',
  'server-workflows-deployed',
  'required-secrets-present',
  'storage-policy-verified',
  'backend-health-check',
  'target-capabilities-supported',
  'artifact-review-match',
  'provider-authority-valid'
] as const

export type BackendProductionGateId = (typeof BACKEND_PRODUCTION_GATE_IDS)[number]
export type BackendProductionGateStatus = 'passed' | 'unknown' | 'failed'

export interface BackendProductionGateResultV1 {
  readonly gate: BackendProductionGateId
  readonly status: BackendProductionGateStatus
  readonly checkedAt: string | null
  readonly evidenceDigest: string | null
}

export interface BackendProductionGateBlocker {
  readonly gate: BackendProductionGateId
  readonly status: 'unknown' | 'failed'
  readonly code: 'production-gate-unknown' | 'production-gate-failed'
  readonly message: string
}

export interface BackendProductionReadiness {
  readonly releaseReady: boolean
  readonly gates: readonly BackendProductionGateResultV1[]
  readonly blockers: readonly BackendProductionGateBlocker[]
}

export interface BackendReleaseArtifactsV1 {
  readonly staticArtifactDigest: string | null
  readonly serverArtifactDigest: string | null
  readonly schemaArtifactDigest: string | null
}

export interface BackendReleaseReviewV1 {
  readonly planDigest: string
  readonly reviewedAt: string
  readonly destructiveOperationIds: readonly string[]
  readonly backupRequired: boolean
}

export interface BackendReleaseFailureV1 {
  readonly code: string
  readonly outcomeUnknown: boolean
}

export interface BackendReleaseReceiptMigrationOperationV1 {
  readonly operationId: string
  readonly kind: string
  readonly risk: 'low' | 'medium' | 'high' | 'destructive'
  readonly checksum: string
}

export interface BackendReleaseReceiptMigrationV1 {
  readonly planId: string
  readonly planDigest: string
  readonly fromModelDigest: string | null
  readonly targetModelDigest: string
  readonly operations: readonly BackendReleaseReceiptMigrationOperationV1[]
}

export interface BackendReleaseReceiptV1 {
  readonly format: 'openpencil.backend-release-receipt'
  readonly version: typeof BACKEND_RELEASE_RECEIPT_VERSION
  readonly receiptId: string
  readonly releaseId: string
  readonly planId: string
  readonly planDigest: string
  readonly documentDigest: string
  readonly irDigest: string
  readonly compilerVersion: string
  readonly target: string
  readonly environment: BackendReleaseEnvironment
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly artifacts: BackendReleaseArtifactsV1
  readonly migration: BackendReleaseReceiptMigrationV1
  readonly requiredEnvironmentNames: readonly string[]
  readonly requiredCredentialRefs: readonly BackendCredentialRef[]
  readonly remoteOperationIds: readonly string[]
  readonly verifiedAt: string | null
  readonly gates: readonly BackendProductionGateResultV1[]
  readonly outcome: Exclude<BackendReleaseOutcome, 'pending'>
  readonly backendDeploymentRequired: boolean
  readonly failure: BackendReleaseFailureV1 | null
}

export interface CreateBackendReleaseReceiptInput {
  readonly receiptId: string
}

export interface BackendReleaseStateV1 {
  readonly version: typeof BACKEND_RELEASE_STATE_VERSION
  readonly releaseId: string
  readonly phase: BackendReleasePhase
  readonly outcome: BackendReleaseOutcome
  readonly dispatch: BackendReleaseDispatchState
  readonly automaticRetryAllowed: boolean
  readonly reconcileRequired: boolean
  readonly inspection: BackendReleaseAuthorityV1 | null
  readonly plan: VerifiedBackendReleasePlanV1 | null
  readonly artifacts: BackendReleaseArtifactsV1 | null
  readonly review: BackendReleaseReviewV1 | null
  readonly confirmations: readonly BackendReleaseDestructiveConfirmationV1[]
  readonly applyReinspectionAccepted: boolean
  readonly singleFlightKey: string | null
  readonly remoteOperationIds: readonly string[]
  readonly verifiedAt: string | null
  readonly gates: readonly BackendProductionGateResultV1[]
  readonly releaseReady: boolean
  readonly backendDeploymentRequired: boolean
  readonly failureCode: string | null
  readonly receipt: BackendReleaseReceiptV1 | null
}

export type BackendReleaseApplyErrorKind =
  | 'timeout'
  | 'abort'
  | 'transport'
  | 'provider-rejected'
  | 'precondition'

export type BackendReleaseReconcileOutcome = 'applied' | 'failed' | 'outcome-unknown'

export type BackendReleaseEvent =
  | { readonly type: 'inspection-completed'; readonly authority: BackendReleaseAuthorityV1 }
  | { readonly type: 'plan-created'; readonly plan: VerifiedBackendReleasePlanV1 }
  | {
      readonly type: 'artifacts-emitted'
      readonly planDigest: string
      readonly artifacts: BackendReleaseArtifactsV1
    }
  | { readonly type: 'review-completed'; readonly review: BackendReleaseReviewV1 }
  | {
      readonly type: 'release-confirmed'
      readonly planDigest: string
      readonly confirmations: readonly BackendReleaseDestructiveConfirmationV1[]
    }
  | {
      readonly type: 'apply-reinspection-completed'
      readonly snapshot: BackendReleaseApplySnapshotV1
    }
  | {
      readonly type: 'apply-dispatched'
      readonly planDigest: string
      readonly singleFlightKey: string
      readonly dispatchedAt: string
    }
  | {
      readonly type: 'apply-completed'
      readonly planDigest: string
      readonly remoteOperationIds: readonly string[]
      readonly completedAt: string
    }
  | {
      readonly type: 'apply-reconciled'
      readonly planDigest: string
      readonly singleFlightKey: string
      readonly outcome: BackendReleaseReconcileOutcome
      readonly code: string | null
      readonly remoteOperationIds: readonly string[]
      readonly reconciledAt: string
    }
  | {
      readonly type: 'apply-error'
      readonly planDigest: string
      readonly kind: BackendReleaseApplyErrorKind
      readonly code: string
      readonly occurredAt: string
      readonly remoteOperationIds?: readonly string[]
    }
  | {
      readonly type: 'release-error'
      readonly planDigest: string
      readonly code: string
      readonly occurredAt: string
    }
  | {
      readonly type: 'cancel-requested'
      readonly reasonCode: string
      readonly cancelledAt: string
    }
  | {
      readonly type: 'verification-completed'
      readonly planDigest: string
      readonly gates: readonly BackendProductionGateResultV1[]
      readonly verifiedAt: string
    }
  | { readonly type: 'receipt-recorded'; readonly receipt: BackendReleaseReceiptV1 }

export interface FrontendDeploymentAssessment {
  readonly frontendHostingProvider: string | null
  readonly backendProvider: string | null
  readonly frontendDeployed: boolean
  readonly backendDeploymentRequired: boolean
  readonly applicationReleaseComplete: boolean
}

export interface FrontendDeploymentFacts {
  readonly frontendHostingProvider: string | null
  readonly backendProvider: string | null
  readonly frontendDeployed: boolean
  readonly backendRequired: boolean
  readonly backendDeployed: boolean
}
