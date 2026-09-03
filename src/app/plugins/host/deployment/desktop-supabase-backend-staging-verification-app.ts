/* oxlint-disable eslint(complexity), eslint(max-lines), typescript-eslint(no-unnecessary-boolean-literal-compare) -- Capability release wiring keeps live schema, Edge, Storage, durable progress, and the final gate receipt in one auditable Host flow. */
import {
  SUPABASE_ARTIFACT_PATHS,
  createSupabaseInspectedMigrationReview,
  type BackendCapabilityDecision,
  type SupabaseInspectedMigrationSnapshotV1
} from '@open-pencil/compiler/backend'
import {
  digestDataModel,
  type BackendCredentialRef,
  type BackendStoragePathRuleIR
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  resolveSupabaseManagementDatabaseWritePat,
  resolveSupabaseManagementGrantGeneration,
  resolveSupabaseManagementPat
} from '@/app/lowcode/supabase/credentials'
import {
  createSupabaseStagingTargetStore,
  type SupabaseStagingTargetStore
} from '@/app/lowcode/supabase/staging-target'
import { appPluginStore } from '@/app/plugins/app'
import { appCredentialServices } from '@/app/settings/credentials/app'
import type { CredentialServices } from '@/app/settings/credentials/services'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

import {
  prepareAppBackendProviderDocumentBuild,
  resolveAppBackendProviderReleaseAuthority,
  type AppBackendProviderHostStore
} from '../backend-provider'
import {
  createIdbBackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournal
} from './backend/release-journal'
import {
  createDesktopSupabaseBackendStagingVerificationService,
  DesktopSupabaseBackendStagingVerificationError,
  type DesktopSupabaseBackendStagingCapabilityReceiptV1,
  type DesktopSupabaseCapabilityDispatchProgressV1,
  type DesktopSupabaseBackendStagingVerificationDependencies,
  type DesktopSupabaseBackendStagingVerificationOutcome,
  type DesktopSupabaseBackendStagingVerificationResult,
  type DesktopSupabaseStrictStagingVerificationInput
} from './desktop-supabase-backend-staging-verification'
import { createSupabaseEdgeFunctionArtifactFromEmission } from './supabase/edge-function-artifact'
import {
  createSupabaseEdgeFunctionRelease,
  type SupabaseEdgeFunctionReleaseReceipt,
  type SupabaseEdgeFunctionReleaseTransports
} from './supabase/edge-function-release'
import {
  createSupabaseManagementEdgeFunctionTransport,
  type SupabaseManagementEdgeFunctionFetch
} from './supabase/management-edge-function-transport'
import {
  createSupabaseManagementPgCatalogTransport,
  type SupabaseManagementDesktopFetch
} from './supabase/management-pg-catalog-transport'
import {
  createSupabaseManagementStorageIsolationTransport,
  type SupabaseManagementStorageFetch
} from './supabase/management-storage-isolation-transport'
import { inspectSupabasePgCatalog } from './supabase/pg-catalog-inspector'
import { verifySupabaseStagingRelease } from './supabase/staging-verifier'
import {
  SUPABASE_STORAGE_ISOLATION_LIMITS,
  createSupabaseStorageIsolationVerification,
  type SupabaseStorageIsolationReceipt,
  type SupabaseStorageIsolationTransport
} from './supabase/storage-isolation-verifier'

type MaybePromise<T> = T | Promise<T>

const FUNCTION_SLUG = 'openpencil-runtime'

export interface AppDesktopSupabaseBackendStagingVerificationOptions {
  readonly isDesktop?: () => boolean
  readonly readFetcher?: SupabaseManagementDesktopFetch
  readonly edgeFetcher?: SupabaseManagementEdgeFunctionFetch
  readonly storageFetcher?: SupabaseManagementStorageFetch
  readonly pluginStore?: AppBackendProviderHostStore
  readonly pluginStoreReady?: () => MaybePromise<unknown>
  readonly credentialServices?: CredentialServices
  readonly stagingTargetStore?: Pick<SupabaseStagingTargetStore, 'read'>
  readonly now?: () => string
  readonly nextId?: () => string
  readonly inspectCatalog?: typeof inspectSupabasePgCatalog
  readonly dispatchJournal?: BackendHostReleaseDispatchJournal
  readonly dependencyOverrides?: Partial<DesktopSupabaseBackendStagingVerificationDependencies>
}

interface StrictRuntime {
  readonly readFetcher: SupabaseManagementDesktopFetch
  readonly edgeFetcher: SupabaseManagementEdgeFunctionFetch
  readonly storageFetcher: SupabaseManagementStorageFetch
  readonly now: () => string
  readonly nextId: () => string
  readonly inspectCatalog: typeof inspectSupabasePgCatalog
}

function randomId(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new DesktopSupabaseBackendStagingVerificationError('verification-failed')
  }
  return crypto.randomUUID()
}

function canonicalTimestamp(now: () => string): string {
  const value = now()
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new DesktopSupabaseBackendStagingVerificationError('verification-failed')
  }
  return value
}

function capabilityIncluded(
  capabilities: readonly BackendCapabilityDecision[],
  capability: string
): boolean {
  return capabilities.some((entry) => entry.capability === capability && entry.included)
}

function requiredReferences(input: DesktopSupabaseStrictStagingVerificationInput): Readonly<{
  environmentNames: readonly string[]
  credentialRefs: readonly BackendCredentialRef[]
}> {
  const environmentNames = input.build.request.application.secrets.flatMap((secret) =>
    secret.kind === 'environment' && secret.required ? [secret.name] : []
  )
  const credentialRefs = input.build.request.application.secrets.flatMap((secret) =>
    secret.kind === 'credential' && secret.required ? [secret.credentialRef] : []
  )
  return Object.freeze({
    environmentNames: Object.freeze([...new Set(environmentNames)].sort()),
    credentialRefs: Object.freeze([...new Set(credentialRefs)].sort())
  })
}

function ruleSupportsCompleteProbe(rule: BackendStoragePathRuleIR): boolean {
  const operations = new Set(rule.operations)
  return (
    operations.has('delete') &&
    (operations.has('upsert') ||
      (operations.has('read') && operations.has('create') && operations.has('update')))
  )
}

function storagePolicyArtifactDigest(input: DesktopSupabaseStrictStagingVerificationInput): string {
  const entry = input.build.emission.manifest.artifacts.find(
    (artifact) =>
      artifact.path === SUPABASE_ARTIFACT_PATHS.storagePolicy && artifact.kind === 'security-policy'
  )
  if (!entry || input.build.emission.files.get(entry.path) === undefined) {
    throw new DesktopSupabaseBackendStagingVerificationError('verification-failed')
  }
  return entry.digest
}

async function liveSnapshot(
  input: DesktopSupabaseStrictStagingVerificationInput,
  runtime: StrictRuntime
): Promise<SupabaseInspectedMigrationSnapshotV1> {
  await input.revalidateLocalAuthority()
  const transport = createSupabaseManagementPgCatalogTransport({
    personalAccessToken: input.readPersonalAccessToken,
    fetcher: runtime.readFetcher,
    signal: input.signal
  })
  const authority = await transport.getProjectAuthority({
    projectRef: input.projectRef,
    grantGeneration: input.grantGeneration
  })
  if (authority.organizationId !== input.accountId) {
    throw new DesktopSupabaseBackendStagingVerificationError('review-stale')
  }
  return runtime.inspectCatalog({
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    transport
  })
}

async function requireAppliedSchema(
  input: DesktopSupabaseStrictStagingVerificationInput,
  snapshot: SupabaseInspectedMigrationSnapshotV1
) {
  const expectedAuthoredTargetModelDigest = await digestDataModel(
    input.build.request.application.dataModel
  )
  const reviewed = await createSupabaseInspectedMigrationReview({
    application: input.build.request.application,
    snapshot,
    expectedProjectRef: input.projectRef,
    expectedAccountId: input.accountId,
    expectedInspectedSchemaDigest: snapshot.inspectedSchemaDigest,
    expectedTargetModelDigest: expectedAuthoredTargetModelDigest
  })
  if (
    reviewed.manifest.authoredTargetModelDigest !== expectedAuthoredTargetModelDigest ||
    reviewed.manifest.currentModelDigest !== reviewed.manifest.targetModelDigest ||
    reviewed.manifest.migrationPlan.operations.length !== 0 ||
    reviewed.manifest.blockers.length !== 0 ||
    reviewed.manifest.reviewReady !== true
  ) {
    throw new DesktopSupabaseBackendStagingVerificationError('schema-not-applied')
  }
  return reviewed
}

function edgeTransportWithLocalRecheck(
  transport: SupabaseEdgeFunctionReleaseTransports,
  revalidate: () => Promise<void>
): SupabaseEdgeFunctionReleaseTransports {
  return Object.freeze({
    ...transport,
    async recheckAuthority(
      authority: Parameters<SupabaseEdgeFunctionReleaseTransports['recheckAuthority']>[0]
    ) {
      await revalidate()
      await transport.recheckAuthority(authority)
    }
  })
}

function storageTransportWithLocalRecheck(
  transport: SupabaseStorageIsolationTransport,
  revalidate: () => Promise<void>
): SupabaseStorageIsolationTransport {
  return Object.freeze({
    ...transport,
    async recheckAuthority(
      authority: Parameters<SupabaseStorageIsolationTransport['recheckAuthority']>[0]
    ) {
      await revalidate()
      await transport.recheckAuthority(authority)
    }
  })
}

function operationOutcome(
  edgeReceipt: SupabaseEdgeFunctionReleaseReceipt | null,
  storageReceipts: readonly SupabaseStorageIsolationReceipt[],
  gates: DesktopSupabaseBackendStagingCapabilityReceiptV1['gates']
): DesktopSupabaseBackendStagingVerificationOutcome {
  if (
    edgeReceipt?.outcome === 'outcome-unknown' ||
    storageReceipts.some((receipt) => receipt.outcome === 'outcome-unknown')
  ) {
    return 'outcome-unknown'
  }
  if (edgeReceipt?.outcome === 'blocked') return 'blocked'
  if (
    edgeReceipt?.outcome === 'failed' ||
    storageReceipts.some((receipt) => receipt.outcome === 'failed') ||
    gates.some((gate) => gate.status === 'failed')
  ) {
    return 'failed'
  }
  return gates.every((gate) => gate.status === 'passed') ? 'succeeded' : 'blocked'
}

async function verifyCapabilities(
  input: DesktopSupabaseStrictStagingVerificationInput,
  runtime: StrictRuntime
): Promise<DesktopSupabaseBackendStagingVerificationResult> {
  const startedAt = canonicalTimestamp(runtime.now)
  const capabilities = input.build.plan.capabilities
  const requiresEdge =
    capabilityIncluded(capabilities, 'server.functions') ||
    capabilityIncluded(capabilities, 'server.http')
  const requiresStorage = capabilityIncluded(capabilities, 'storage.objects')
  if (requiresEdge && !input.edgeUserAccessToken) {
    throw new DesktopSupabaseBackendStagingVerificationError('transient-auth-missing')
  }
  if (requiresStorage && (!input.storageUserA || !input.storageUserB)) {
    throw new DesktopSupabaseBackendStagingVerificationError('transient-auth-missing')
  }

  const snapshot = await liveSnapshot(input, runtime)
  await requireAppliedSchema(input, snapshot)

  let edgeArtifact: Awaited<
    ReturnType<typeof createSupabaseEdgeFunctionArtifactFromEmission>
  > | null = null
  let edgeReceipt: SupabaseEdgeFunctionReleaseReceipt | null = null
  let edgeReleaseId: string | null = null
  const storageReceipts: SupabaseStorageIsolationReceipt[] = []
  const storageVerificationIds: Array<{
    bucketId: string
    ruleId: string
    verificationId: string
  }> = []
  let policyDigest: string | null = null
  type EdgeProgress = NonNullable<DesktopSupabaseCapabilityDispatchProgressV1['edge']>
  let edgeProgress: EdgeProgress | null = null
  const storageProgress: Array<DesktopSupabaseCapabilityDispatchProgressV1['storage'][number]> = []

  const progress = (
    stage: DesktopSupabaseCapabilityDispatchProgressV1['stage']
  ): DesktopSupabaseCapabilityDispatchProgressV1 =>
    Object.freeze({
      format: 'openpencil.supabase-capability-dispatch-progress.v1' as const,
      version: 1 as const,
      verificationId: input.verificationId,
      projectRef: input.projectRef,
      accountId: input.accountId,
      grantGeneration: input.grantGeneration,
      documentDigest: input.documentDigest,
      reviewedArtifactDigest: input.expectedReview.artifact.manifestDigest,
      target: Object.freeze({
        target: input.build.plan.target,
        applicationDigest: input.build.plan.applicationDigest,
        planDigest: input.build.plan.planDigest,
        emissionManifestDigest: input.build.emission.manifestDigest
      }),
      stage,
      edge: edgeProgress,
      storage: Object.freeze(storageProgress.map((entry) => Object.freeze({ ...entry })))
    })

  if (requiresEdge) {
    edgeArtifact = await createSupabaseEdgeFunctionArtifactFromEmission({
      emission: input.build.emission,
      functionSlug: FUNCTION_SLUG
    })
    const rawTransport = createSupabaseManagementEdgeFunctionTransport({
      personalAccessToken: input.writePersonalAccessToken,
      publishableKey: input.publishableKey,
      userAccessToken: input.edgeUserAccessToken as string,
      authority: {
        projectRef: input.projectRef,
        accountId: input.accountId,
        grantGeneration: input.grantGeneration
      },
      fetcher: runtime.edgeFetcher,
      now: runtime.now,
      signal: input.signal
    })
    edgeReleaseId = runtime.nextId()
    edgeReceipt = await createSupabaseEdgeFunctionRelease({
      releaseId: edgeReleaseId,
      authority: {
        releaseAuthority: 'host.supabase-edge-functions.v1',
        environment: 'staging',
        projectRef: input.projectRef,
        accountId: input.accountId,
        grantGeneration: input.grantGeneration,
        provider: input.backendProvider,
        artifactDigest: edgeArtifact.artifactDigest,
        functionSlug: edgeArtifact.functionSlug
      },
      artifact: edgeArtifact,
      transports: edgeTransportWithLocalRecheck(rawTransport, input.revalidateLocalAuthority),
      now: runtime.now,
      async beforeDispatch(evidence) {
        edgeProgress = Object.freeze({
          releaseId: evidence.releaseId,
          functionSlug: evidence.functionSlug,
          artifactDigest: evidence.artifactDigest,
          secretInspectionEvidenceDigest: evidence.secretInspectionEvidenceDigest,
          functionId: null,
          versionId: null,
          operationId: null,
          outcome: null
        })
        await input.claimBeforeMutation(progress('edge-pre-dispatch'))
      },
      async onRemoteEvidence(evidence) {
        edgeProgress = Object.freeze({
          ...(edgeProgress as EdgeProgress),
          functionId: evidence.functionId,
          versionId: evidence.versionId,
          operationId: evidence.operationId
        })
        await input.recordMutationProgress(progress('edge-deployed'))
      }
    }).dispatch()
    if (edgeReceipt.dispatch !== 'not-dispatched') {
      if (!edgeReceipt.secretInspection) {
        throw new DesktopSupabaseBackendStagingVerificationError('verification-failed')
      }
      edgeProgress = Object.freeze({
        releaseId: edgeReceipt.releaseId,
        functionSlug: edgeReceipt.functionSlug,
        artifactDigest: edgeReceipt.artifactDigest,
        secretInspectionEvidenceDigest: edgeReceipt.secretInspection.evidenceDigest,
        functionId: edgeReceipt.remote.functionId,
        versionId: edgeReceipt.remote.versionId,
        operationId: edgeReceipt.remote.operationIds[0] ?? null,
        outcome: edgeReceipt.outcome
      })
      await input.recordMutationProgress(progress('edge-settled'))
    }
  }

  const canContinueAfterEdge =
    !edgeReceipt || (edgeReceipt.outcome === 'succeeded' && edgeReceipt.dispatch === 'dispatched')
  if (requiresStorage && canContinueAfterEdge) {
    policyDigest = storagePolicyArtifactDigest(input)
    const userA = input.storageUserA as NonNullable<typeof input.storageUserA>
    const userB = input.storageUserB as NonNullable<typeof input.storageUserB>
    const rawTransport = createSupabaseManagementStorageIsolationTransport({
      personalAccessToken: input.writePersonalAccessToken,
      publishableKey: input.publishableKey,
      authority: {
        projectRef: input.projectRef,
        accountId: input.accountId,
        grantGeneration: input.grantGeneration
      },
      userA,
      userB,
      tenantPartitions: input.tenantPartitions,
      fetcher: runtime.storageFetcher,
      now: runtime.now,
      signal: input.signal
    })
    const transport = storageTransportWithLocalRecheck(rawTransport, input.revalidateLocalAuthority)
    const buckets = input.build.request.application.storage?.buckets ?? []
    for (const bucket of buckets) {
      for (const rule of bucket.pathRules) {
        if (bucket.access !== 'private' || !ruleSupportsCompleteProbe(rule)) {
          throw new DesktopSupabaseBackendStagingVerificationError('verification-failed')
        }
        const verificationId = runtime.nextId()
        storageVerificationIds.push({ bucketId: bucket.id, ruleId: rule.id, verificationId })
        const receipt = await createSupabaseStorageIsolationVerification({
          verificationId,
          application: input.build.request.application,
          authority: {
            releaseAuthority: 'host.supabase-storage-isolation.v1',
            environment: 'staging',
            projectRef: input.projectRef,
            accountId: input.accountId,
            grantGeneration: input.grantGeneration,
            provider: input.backendProvider,
            applicationDigest: input.build.plan.applicationDigest,
            storagePolicyArtifactDigest: policyDigest
          },
          bucketId: bucket.id,
          ruleId: rule.id,
          maxProbePayloadBytes: Math.min(
            SUPABASE_STORAGE_ISOLATION_LIMITS.maxProbePayloadBytes,
            bucket.maxObjectBytes + 1 <= SUPABASE_STORAGE_ISOLATION_LIMITS.maxProbePayloadBytes
              ? bucket.maxObjectBytes + 1
              : Math.min(32, bucket.maxObjectBytes)
          ),
          transport,
          now: runtime.now,
          async beforeDispatch(evidence) {
            storageProgress.push(
              Object.freeze({
                verificationId: evidence.verificationId,
                bucketId: evidence.bucketId,
                bucketName: evidence.bucketName,
                ruleId: evidence.ruleId,
                potentialResidualObjectPaths: Object.freeze([
                  ...evidence.potentialResidualObjectPaths
                ]),
                residualObjectPaths: Object.freeze([...evidence.potentialResidualObjectPaths]),
                remoteOperationIds: Object.freeze([]),
                outcome: null
              })
            )
            await input.claimBeforeMutation(progress('storage-pre-dispatch'))
          },
          async onProgress(evidence) {
            const index = storageProgress.findIndex(
              (entry) => entry.verificationId === evidence.verificationId
            )
            if (index === -1) {
              throw new DesktopSupabaseBackendStagingVerificationError('verification-failed')
            }
            storageProgress[index] = Object.freeze({
              ...storageProgress[index],
              residualObjectPaths: Object.freeze([...evidence.residualObjectPaths]),
              remoteOperationIds: Object.freeze([...evidence.remoteOperationIds])
            })
            await input.recordMutationProgress(progress('storage-progress'))
          }
        }).verify()
        storageReceipts.push(receipt)
        const progressIndex = storageProgress.findIndex(
          (entry) => entry.verificationId === receipt.verificationId
        )
        if (progressIndex !== -1) {
          storageProgress[progressIndex] = Object.freeze({
            ...storageProgress[progressIndex],
            residualObjectPaths: Object.freeze([...receipt.residualObjectPaths]),
            remoteOperationIds: Object.freeze([...receipt.remoteOperationIds]),
            outcome: receipt.outcome
          })
          await input.recordMutationProgress(progress('storage-settled'))
        }
        if (receipt.outcome !== 'succeeded') break
      }
      if (storageReceipts.at(-1)?.outcome !== 'succeeded') break
    }
  }

  const references = requiredReferences(input)
  const remoteOperationIds = Object.freeze([
    ...(edgeReceipt?.remote.operationIds ?? []),
    ...storageReceipts.flatMap((receipt) => receipt.remoteOperationIds)
  ])
  const completedAt = canonicalTimestamp(runtime.now)
  const verification = await verifySupabaseStagingRelease({
    application: input.build.request.application,
    capabilities,
    backendProvider: input.backendProvider,
    reviewedBackendProvider: input.expectedReview.artifact.manifest.backendProvider,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    planDigest: input.build.plan.planDigest,
    reviewedArtifactDigest: input.expectedReview.artifact.manifestDigest,
    expectedReviewedArtifactDigest: input.expectedReview.artifact.manifestDigest,
    reviewed: input.expectedReview.artifact.inspectedReview,
    postApplySnapshot: snapshot,
    expectedPostApplySchemaDigest: snapshot.inspectedSchemaDigest,
    remoteOperationIds,
    requiredEnvironmentNames: references.environmentNames,
    requiredCredentialRefs: references.credentialRefs,
    expectedEdgeFunctionArtifactDigest: edgeArtifact?.artifactDigest ?? null,
    expectedEdgeFunctionHealthIdentity: edgeArtifact?.healthIdentity ?? null,
    expectedEdgeFunctionRequiredSecretNames: edgeArtifact?.requiredSecretNames ?? [],
    edgeFunctionReceipt: edgeReceipt,
    expectedStoragePolicyArtifactDigest: policyDigest,
    storageIsolationReceipts: Object.freeze([...storageReceipts]),
    receiptAuthority: Object.freeze({
      startedAt,
      edgeFunctionReleaseId: edgeReleaseId,
      storageVerificationIds: Object.freeze(
        storageVerificationIds.map((entry) => Object.freeze({ ...entry }))
      )
    }),
    checkedAt: completedAt
  })
  const outcome = operationOutcome(edgeReceipt, storageReceipts, verification.gates)
  const receipt = Object.freeze({
    format: 'openpencil.supabase-backend-staging-capability-receipt.v1' as const,
    version: 1 as const,
    verificationId: input.verificationId,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    reviewedArtifactDigest: input.expectedReview.artifact.manifestDigest,
    outcome,
    schemaApplied: verification.schemaApplied,
    edgeFunctionReceipt: edgeReceipt,
    storageIsolationReceipts: Object.freeze([...storageReceipts]),
    gates: Object.freeze([...verification.gates]),
    startedAt,
    completedAt
  }) satisfies DesktopSupabaseBackendStagingCapabilityReceiptV1
  return Object.freeze({
    receipt,
    receiptDigest: await digestCanonicalManifest(receipt),
    productionReleaseReady: false as const
  })
}

export function createAppDesktopSupabaseBackendStagingVerificationService(
  options: AppDesktopSupabaseBackendStagingVerificationOptions = {}
) {
  const pluginStore = options.pluginStore ?? appPluginStore
  const waitForPluginStoreReady =
    options.pluginStoreReady ??
    (options.pluginStore
      ? () => undefined
      : () => (appPluginStore.snapshot().ready ? undefined : appPluginStore.load()))
  const credentials = options.credentialServices ?? appCredentialServices
  const runtime: StrictRuntime = Object.freeze({
    readFetcher: options.readFetcher ?? tauriFetch,
    edgeFetcher: options.edgeFetcher ?? tauriFetch,
    storageFetcher: options.storageFetcher ?? tauriFetch,
    now: options.now ?? (() => new Date().toISOString()),
    nextId: options.nextId ?? randomId,
    inspectCatalog: options.inspectCatalog ?? inspectSupabasePgCatalog
  })
  const dependencies: DesktopSupabaseBackendStagingVerificationDependencies = {
    isDesktop: options.isDesktop ?? isTauri,
    nextId: runtime.nextId,
    now: runtime.now,
    dispatchJournal: options.dispatchJournal ?? createIdbBackendHostReleaseDispatchJournal(),
    async prepareBuild(graph) {
      await Promise.resolve(waitForPluginStoreReady())
      return prepareAppBackendProviderDocumentBuild(pluginStore, graph, {
        target: 'react',
        mode: 'production'
      })
    },
    resolveBackendProviderAuthority(build) {
      return resolveAppBackendProviderReleaseAuthority(pluginStore, build.descriptor)
    },
    resolveReadCredential: () => resolveSupabaseManagementPat(credentials),
    resolveWriteCredential: () => resolveSupabaseManagementDatabaseWritePat(credentials),
    resolveGrantGeneration: () => resolveSupabaseManagementGrantGeneration(credentials),
    resolveStagingTargetBinding: () =>
      (options.stagingTargetStore ?? createSupabaseStagingTargetStore()).read(),
    prepareStrictVerification: (input) => verifyCapabilities(input, runtime),
    ...options.dependencyOverrides
  }
  return createDesktopSupabaseBackendStagingVerificationService(dependencies)
}

export const appDesktopSupabaseBackendStagingVerificationService =
  createAppDesktopSupabaseBackendStagingVerificationService()
