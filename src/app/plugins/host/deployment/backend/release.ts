import {
  createBackendReleasePlan,
  createBackendReleaseReceipt,
  createBackendReleaseState,
  digestDataModel,
  reduceBackendReleaseState,
  type BackendCredentialRef,
  type BackendReleaseEnvironment,
  type BackendReleaseProviderAuthorityV1,
  type BackendReleaseStateV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { PreparedAppBackendProviderBuild } from '@/app/plugins/host/backend-provider'

const UNRESOLVED_REMOTE_PROJECT = 'remote-project-unresolved'
const UNRESOLVED_REMOTE_ACCOUNT = 'remote-account-unresolved'
const UNRESOLVED_REMOTE_GRANT = 'remote-grant-unresolved'

export interface PrepareAppBackendReleaseReviewOptions {
  readonly build: PreparedAppBackendProviderBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentIdentity: string
  readonly environment: BackendReleaseEnvironment
  readonly onTransition?: (state: BackendReleaseStateV1) => void
}

function appCompilerVersion(): string {
  return typeof __OPENPENCIL_APP_VERSION__ === 'string' ? __OPENPENCIL_APP_VERSION__ : '0.0.0-test'
}

function nextReleaseIdentifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function publishTransition(
  state: BackendReleaseStateV1,
  observer?: (state: BackendReleaseStateV1) => void
): BackendReleaseStateV1 {
  observer?.(state)
  return state
}

function requiredReferences(build: PreparedAppBackendProviderBuild): Readonly<{
  environmentNames: readonly string[]
  credentialRefs: readonly BackendCredentialRef[]
}> {
  const environmentNames = build.request.application.secrets
    .filter((secret) => secret.kind === 'environment' && secret.required)
    .map((secret) => secret.name)
  const credentialRefs = build.request.application.secrets.flatMap((secret) =>
    secret.kind === 'credential' && secret.required ? [secret.credentialRef] : []
  )
  return {
    environmentNames: Object.freeze([...new Set(environmentNames)].sort()),
    credentialRefs: Object.freeze([...new Set(credentialRefs)].sort())
  }
}

/**
 * Advances the public Release Core through local Inspect, Plan, Emit, and Review only. Remote
 * schema/project/account/grant authority is deliberately represented by a fail-closed sentinel.
 * A future Backend Apply must perform a real Inspect, which necessarily invalidates this local
 * proposal and creates a new reviewed plan. This function has no credential or remote executor.
 */
export async function prepareAppBackendReleaseReview(
  options: PrepareAppBackendReleaseReviewOptions
): Promise<BackendReleaseStateV1> {
  const { build, backendProvider, onTransition } = options
  const [documentDigest, targetModelDigest, unresolvedSchemaDigest] = await Promise.all([
    digestCanonicalManifest({
      format: 'openpencil.app-backend-release-document.v1',
      documentIdentity: options.documentIdentity,
      request: build.request
    }),
    digestDataModel(build.request.application.dataModel),
    digestCanonicalManifest({
      format: 'openpencil.backend-release-unresolved-remote-schema.v1',
      providerId: backendProvider.providerId,
      applicationDigest: build.plan.applicationDigest
    })
  ])
  const references = requiredReferences(build)
  const localPlanId = nextReleaseIdentifier('app-backend-plan')
  const authority = {
    documentDigest,
    irDigest: build.plan.applicationDigest,
    inspectedSchemaDigest: unresolvedSchemaDigest,
    compilerVersion: appCompilerVersion(),
    target: build.plan.target,
    environment: options.environment,
    projectId: UNRESOLVED_REMOTE_PROJECT,
    accountId: UNRESOLVED_REMOTE_ACCOUNT,
    grantGeneration: UNRESOLVED_REMOTE_GRANT,
    backendProvider
  } as const
  const plan = await createBackendReleasePlan({
    planId: localPlanId,
    authority,
    migrationPlan: {
      version: 1,
      planId: localPlanId,
      targetModelDigest,
      operations: [],
      highestRisk: 'low',
      requiresBackup: false
    },
    requiredArtifactKinds: ['schema'],
    requiredEnvironmentNames: references.environmentNames,
    requiredCredentialRefs: references.credentialRefs
  })

  let state = publishTransition(
    createBackendReleaseState(nextReleaseIdentifier('app-backend-release')),
    onTransition
  )
  state = publishTransition(
    reduceBackendReleaseState(state, { type: 'inspection-completed', authority }),
    onTransition
  )
  state = publishTransition(
    reduceBackendReleaseState(state, { type: 'plan-created', plan }),
    onTransition
  )
  state = publishTransition(
    reduceBackendReleaseState(state, {
      type: 'artifacts-emitted',
      planDigest: plan.planDigest,
      artifacts: {
        staticArtifactDigest: null,
        serverArtifactDigest: null,
        // The deterministic Backend artifact manifest binds the complete locally reviewed bundle.
        // It is not evidence that a remote schema was applied.
        schemaArtifactDigest: build.emission.manifestDigest
      }
    }),
    onTransition
  )
  return publishTransition(
    reduceBackendReleaseState(state, {
      type: 'review-completed',
      review: {
        planDigest: plan.planDigest,
        reviewedAt: new Date().toISOString(),
        destructiveOperationIds: [],
        backupRequired: false
      }
    }),
    onTransition
  )
}

/** Records human confirmation but deliberately leaves Backend Apply not-dispatched. */
export function confirmAppBackendReleaseReview(
  state: BackendReleaseStateV1,
  onTransition?: (state: BackendReleaseStateV1) => void
): BackendReleaseStateV1 {
  const plan = state.plan
  if (!plan) throw new Error('A reviewed Backend Release plan is required.')
  return publishTransition(
    reduceBackendReleaseState(state, {
      type: 'release-confirmed',
      planDigest: plan.planDigest,
      confirmations: []
    }),
    onTransition
  )
}

/** Creates a secret-free cancellation receipt when confirmation is denied before any dispatch. */
export function cancelAppBackendReleaseReview(
  state: BackendReleaseStateV1,
  onTransition?: (state: BackendReleaseStateV1) => void
): BackendReleaseStateV1 {
  const cancelled = publishTransition(
    reduceBackendReleaseState(state, {
      type: 'cancel-requested',
      reasonCode: 'confirmation-denied',
      cancelledAt: new Date().toISOString()
    }),
    onTransition
  )
  const receipt = createBackendReleaseReceipt(cancelled, {
    receiptId: nextReleaseIdentifier('app-backend-receipt')
  })
  return publishTransition(
    reduceBackendReleaseState(cancelled, { type: 'receipt-recorded', receipt }),
    onTransition
  )
}
