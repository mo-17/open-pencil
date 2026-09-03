import type { SupabaseInspectedMigrationSnapshotV1 } from '@open-pencil/compiler/backend'

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
import { BackendHostReleaseApplyError } from './backend/release-controller'
import type { BackendHostReleaseDispatchJournal } from './backend/release-journal'
import { createIdbBackendHostReleaseDispatchJournal } from './backend/release-journal'
import {
  createDesktopSupabaseBackendStagingReleaseService,
  DesktopSupabaseBackendStagingReleaseError,
  type DesktopSupabaseBackendStagingReleaseDependencies,
  type DesktopSupabaseBackendStagingReleaseService,
  type DesktopSupabaseStrictStagingReleaseInput
} from './desktop-supabase-backend-staging-release'
import {
  createSupabaseBackendRelease,
  type SupabaseBackendReleaseReviewArtifactV1
} from './supabase/backend-release'
import {
  createSupabaseManagementDatabaseApplyTransport,
  SupabaseManagementDatabaseApplyTransportError,
  type SupabaseManagementDatabaseApplyFetch
} from './supabase/management-database-apply-transport'
import {
  createSupabaseManagementPgCatalogTransport,
  type SupabaseManagementDesktopFetch
} from './supabase/management-pg-catalog-transport'
import { inspectSupabasePgCatalog } from './supabase/pg-catalog-inspector'
import { reconcileSupabaseStagingBaseline } from './supabase/staging-reconciliation'

type MaybePromise<T> = T | Promise<T>

export interface AppDesktopSupabaseBackendStagingReleaseOptions {
  readonly isDesktop?: () => boolean
  readonly readFetcher?: SupabaseManagementDesktopFetch
  readonly writeFetcher?: SupabaseManagementDatabaseApplyFetch
  readonly pluginStore?: AppBackendProviderHostStore
  /** Resolve the current Store load, including reloads started after this service was created. */
  readonly pluginStoreReady?: () => MaybePromise<unknown>
  readonly credentialServices?: CredentialServices
  readonly stagingTargetStore?: Pick<SupabaseStagingTargetStore, 'read'>
  readonly dispatchJournal?: BackendHostReleaseDispatchJournal
  readonly now?: () => string
  readonly nextId?: () => string
  readonly inspectCatalog?: typeof inspectSupabasePgCatalog
  readonly dependencyOverrides?: Partial<DesktopSupabaseBackendStagingReleaseDependencies>
}

const dispatchJournal = createIdbBackendHostReleaseDispatchJournal()

function compilerVersion(): string {
  return typeof __OPENPENCIL_APP_VERSION__ === 'string' ? __OPENPENCIL_APP_VERSION__ : '0.0.0-test'
}

function randomId(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new DesktopSupabaseBackendStagingReleaseError('release-failed')
  }
  return crypto.randomUUID()
}

function strictSnapshot(
  value: SupabaseInspectedMigrationSnapshotV1
): SupabaseInspectedMigrationSnapshotV1 {
  if (!value.inspectedSchemaDigest) {
    throw new DesktopSupabaseBackendStagingReleaseError('release-failed')
  }
  return value
}

function sameArtifactAuthority(
  artifact: SupabaseBackendReleaseReviewArtifactV1,
  input: DesktopSupabaseStrictStagingReleaseInput
): boolean {
  const expected = input.expectedReview.artifact
  return (
    artifact.manifestDigest === input.expectedReviewArtifactDigest &&
    artifact.manifestDigest === expected.manifestDigest &&
    JSON.stringify(artifact.manifest) === JSON.stringify(expected.manifest) &&
    artifact.inspectedReview.manifestDigest === expected.inspectedReview.manifestDigest &&
    artifact.inspectedReview.manifest.sqlDigest === expected.inspectedReview.manifest.sqlDigest &&
    artifact.manifest.documentDigest === input.documentDigest &&
    artifact.manifest.remoteAuthority.projectRef === input.projectRef &&
    artifact.manifest.remoteAuthority.accountId === input.accountId &&
    artifact.manifest.remoteAuthority.grantGeneration === input.grantGeneration &&
    JSON.stringify(artifact.manifest.backendProvider) === JSON.stringify(input.backendProvider)
  )
}

async function prepareStrictStagingRelease(
  input: DesktopSupabaseStrictStagingReleaseInput,
  options: Readonly<{
    isDesktop: () => boolean
    readFetcher: SupabaseManagementDesktopFetch
    writeFetcher: SupabaseManagementDatabaseApplyFetch
    dispatchJournal: BackendHostReleaseDispatchJournal
    now: () => string
    nextId: () => string
    inspectCatalog: typeof inspectSupabasePgCatalog
  }>
) {
  if (!options.isDesktop()) {
    throw new DesktopSupabaseBackendStagingReleaseError('desktop-required')
  }
  const readTransport = createSupabaseManagementPgCatalogTransport({
    personalAccessToken: input.readPersonalAccessToken,
    fetcher: options.readFetcher,
    signal: input.signal
  })
  const projectAuthority = await readTransport.getProjectAuthority({
    projectRef: input.projectRef,
    grantGeneration: input.grantGeneration
  })
  if (projectAuthority.organizationId !== input.accountId) {
    throw new DesktopSupabaseBackendStagingReleaseError('review-stale')
  }
  const writeTransport = createSupabaseManagementDatabaseApplyTransport({
    personalAccessToken: input.writePersonalAccessToken,
    fetcher: options.writeFetcher,
    signal: input.signal
  })
  let reviewedArtifactMatched = false
  let reviewAttempted = false
  const didReviewMatch = () => reviewedArtifactMatched
  const wasReviewAttempted = () => reviewAttempted
  const release = createSupabaseBackendRelease({
    build: input.build,
    backendProvider: input.backendProvider,
    documentDigest: input.documentDigest,
    compilerVersion: compilerVersion(),
    environment: input.environment,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    dispatchJournal: options.dispatchJournal,
    revalidateLocalAuthority: input.revalidateLocalAuthority,
    async snapshotProvider() {
      const snapshot = strictSnapshot(
        await options.inspectCatalog({
          projectRef: input.projectRef,
          accountId: input.accountId,
          grantGeneration: input.grantGeneration,
          transport: readTransport
        })
      )
      return { snapshot, expectedInspectedSchemaDigest: snapshot.inspectedSchemaDigest }
    },
    reviewBackendRelease({ artifact }) {
      reviewAttempted = true
      reviewedArtifactMatched = sameArtifactAuthority(artifact, input)
      return reviewedArtifactMatched
    },
    confirmBackendRelease({ artifact }) {
      return reviewedArtifactMatched && sameArtifactAuthority(artifact, input) ? [] : null
    },
    stagingApply: {
      expectedReviewArtifactDigest: input.expectedReviewArtifactDigest,
      async prepareApply(context) {
        await input.revalidateLocalAuthority({ stage: 'pre-apply' })
        const prepared = await writeTransport.prepareReviewedMigration(context)
        return Object.freeze({
          async dispatch() {
            try {
              await input.revalidateLocalAuthority({ stage: 'pre-apply' })
            } catch (cause) {
              throw new BackendHostReleaseApplyError(
                'precondition',
                'supabase-staging-local-authority-changed',
                [],
                { cause }
              )
            }
            let confirmation
            try {
              confirmation = await prepared.dispatch()
            } catch (cause) {
              if (
                cause instanceof SupabaseManagementDatabaseApplyTransportError &&
                cause.code === 'authority-recheck-failed'
              ) {
                throw new BackendHostReleaseApplyError(
                  'precondition',
                  'supabase-staging-project-authority-recheck-failed',
                  [],
                  { cause }
                )
              }
              throw cause
            }
            return { ok: true as const, remoteOperationIds: confirmation.remoteOperationIds }
          }
        })
      },
      async reconcile({ release }) {
        return reconcileSupabaseStagingBaseline(release, options.now())
      }
    },
    now: options.now
  })
  const state = await release.run({
    releaseId: options.nextId(),
    planId: options.nextId(),
    receiptId: options.nextId(),
    ...(input.onTransition ? { onTransition: input.onTransition } : {})
  })
  if (wasReviewAttempted() && !didReviewMatch()) {
    throw new DesktopSupabaseBackendStagingReleaseError('review-stale')
  }
  return state
}

export function createAppDesktopSupabaseBackendStagingReleaseService(
  options: AppDesktopSupabaseBackendStagingReleaseOptions = {}
): DesktopSupabaseBackendStagingReleaseService {
  const pluginStore = options.pluginStore ?? appPluginStore
  const waitForPluginStoreReady =
    options.pluginStoreReady ??
    (options.pluginStore
      ? () => undefined
      : () => (appPluginStore.snapshot().ready ? undefined : appPluginStore.load()))
  const credentials = options.credentialServices ?? appCredentialServices
  const runtime = Object.freeze({
    isDesktop: options.isDesktop ?? isTauri,
    readFetcher: options.readFetcher ?? tauriFetch,
    writeFetcher: options.writeFetcher ?? tauriFetch,
    dispatchJournal: options.dispatchJournal ?? dispatchJournal,
    now: options.now ?? (() => new Date().toISOString()),
    nextId: options.nextId ?? randomId,
    inspectCatalog: options.inspectCatalog ?? inspectSupabasePgCatalog
  })
  const dependencies: DesktopSupabaseBackendStagingReleaseDependencies = {
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
    prepareStrictStagingRelease: (input) => prepareStrictStagingRelease(input, runtime),
    ...options.dependencyOverrides
  }
  return createDesktopSupabaseBackendStagingReleaseService(dependencies)
}

export const appDesktopSupabaseBackendStagingReleaseService =
  createAppDesktopSupabaseBackendStagingReleaseService()
