import type { SupabaseInspectedMigrationSnapshotV1 } from '@open-pencil/compiler/backend'

import {
  resolveSupabaseManagementGrantGeneration,
  resolveSupabaseManagementPat,
  supabaseManagementPatStatus
} from '@/app/lowcode/supabase/credentials'
import { appPluginStore } from '@/app/plugins/app'
import { appCredentialServices } from '@/app/settings/credentials/app'
import type { CredentialServices } from '@/app/settings/credentials/services'
import { isTauri } from '@/app/tauri/env'
import { SupabaseManagementNativeError } from '@/app/tauri/supabase-management'

import {
  prepareAppBackendProviderDocumentBuild,
  resolveAppBackendProviderReleaseAuthority,
  type AppBackendProviderHostStore
} from '@/app/plugins/host/backend-provider'
import { createIdbBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import {
  createDesktopSupabaseBackendReviewService,
  DesktopSupabaseBackendReviewError,
  type DesktopSupabaseBackendReviewDependencies,
  type DesktopSupabaseBackendReviewService,
  type DesktopSupabaseStrictReviewInput
} from './review'
import {
  createSupabaseBackendRelease,
  type SupabaseBackendReleaseReviewArtifactV1
} from '@/app/plugins/host/deployment/supabase/backend-release'
import {
  createSupabaseManagementPgCatalogTransport,
  type SupabaseManagementDesktopFetch
} from '@/app/plugins/host/deployment/supabase/management/pg-catalog-transport'
import {
  createNativeSupabaseManagementPgCatalogTransport,
  isProductionNativeSupabaseManagementPgCatalogTransportV1
} from '@/app/plugins/host/deployment/supabase/native-pg-catalog-transport'
import { inspectSupabasePgCatalog } from '@/app/plugins/host/deployment/supabase/pg-catalog-inspector'

type MaybePromise<T> = T | Promise<T>

export interface AppDesktopSupabaseBackendReviewForTestingOptionsV1 {
  readonly isDesktop?: () => boolean
  /** Test-only legacy HTTP seam. Production Desktop inspection uses the fixed native command. */
  readonly fetcher?: SupabaseManagementDesktopFetch
  readonly pluginStore?: AppBackendProviderHostStore
  /** Resolve the current Store load, including reloads started after this service was created. */
  readonly pluginStoreReady?: () => MaybePromise<unknown>
  readonly credentialServices?: CredentialServices
  readonly now?: () => string
  readonly nextId?: () => string
  readonly inspectCatalog?: typeof inspectSupabasePgCatalog
  readonly dependencyOverrides?: Partial<DesktopSupabaseBackendReviewDependencies>
}

const dispatchJournal = createIdbBackendHostReleaseDispatchJournal()

function compilerVersion(): string {
  return typeof __OPENPENCIL_APP_VERSION__ === 'string' ? __OPENPENCIL_APP_VERSION__ : '0.0.0-test'
}

function randomId(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new DesktopSupabaseBackendReviewError('review-failed')
  }
  return crypto.randomUUID()
}

function strictSnapshot(
  value: SupabaseInspectedMigrationSnapshotV1
): SupabaseInspectedMigrationSnapshotV1 {
  if (!value.inspectedSchemaDigest) {
    throw new DesktopSupabaseBackendReviewError('review-failed')
  }
  return value
}

function failNativeReview(cause: SupabaseManagementNativeError): never {
  if (cause.code === 'credential-missing' || cause.code === 'credential-unavailable') {
    throw new DesktopSupabaseBackendReviewError('credential-missing')
  }
  if (cause.code === 'credential-changed') {
    throw new DesktopSupabaseBackendReviewError('grant-changed')
  }
  throw new DesktopSupabaseBackendReviewError('review-failed')
}

async function prepareStrictReview(
  input: DesktopSupabaseStrictReviewInput,
  options: Readonly<{
    isDesktop: () => boolean
    fetcher?: SupabaseManagementDesktopFetch
    now: () => string
    nextId: () => string
    inspectCatalog: typeof inspectSupabasePgCatalog
  }>
): Promise<SupabaseBackendReleaseReviewArtifactV1> {
  if (!options.isDesktop()) throw new DesktopSupabaseBackendReviewError('desktop-required')
  if (
    (options.fetcher && input.personalAccessToken === null) ||
    (!options.fetcher && input.personalAccessToken !== null)
  ) {
    throw new DesktopSupabaseBackendReviewError('review-failed')
  }
  const transport = options.fetcher
    ? createSupabaseManagementPgCatalogTransport({
        personalAccessToken: input.personalAccessToken as string,
        fetcher: options.fetcher,
        signal: input.signal
      })
    : createNativeSupabaseManagementPgCatalogTransport({
        expectedOrganizationId: null,
        signal: input.signal
      })
  if (!options.fetcher && !isProductionNativeSupabaseManagementPgCatalogTransportV1(transport)) {
    throw new DesktopSupabaseBackendReviewError('review-failed')
  }
  let projectAuthority
  try {
    projectAuthority = await transport.getProjectAuthority({
      projectRef: input.projectRef,
      grantGeneration: input.grantGeneration
    })
  } catch (cause) {
    if (!options.fetcher && cause instanceof SupabaseManagementNativeError) {
      return failNativeReview(cause)
    }
    throw cause
  }
  const reviewCapture: { artifact: SupabaseBackendReleaseReviewArtifactV1 | null } = {
    artifact: null
  }
  const release = createSupabaseBackendRelease({
    build: input.build,
    backendProvider: input.backendProvider,
    documentDigest: input.documentDigest,
    compilerVersion: compilerVersion(),
    environment: input.environment,
    projectRef: input.projectRef,
    accountId: projectAuthority.organizationId,
    grantGeneration: input.grantGeneration,
    ...(input.stagedExecutionPlan
      ? { stagedExecution: { executionPlan: input.stagedExecutionPlan } }
      : {}),
    dispatchJournal,
    revalidateLocalAuthority: input.revalidateLocalAuthority,
    async snapshotProvider() {
      const snapshot = strictSnapshot(
        await options.inspectCatalog({
          projectRef: input.projectRef,
          accountId: projectAuthority.organizationId,
          grantGeneration: input.grantGeneration,
          transport
        })
      )
      return { snapshot, expectedInspectedSchemaDigest: snapshot.inspectedSchemaDigest }
    },
    reviewBackendRelease({ artifact }) {
      reviewCapture.artifact = artifact
      // This product entry is explicitly review-only. It cannot authorize confirmation or Apply.
      return false
    },
    confirmBackendRelease() {
      return null
    },
    now: options.now
  })
  const state = await release.run({
    releaseId: options.nextId(),
    planId: options.nextId(),
    receiptId: options.nextId()
  })
  const visibleArtifact = reviewCapture.artifact
  if (!visibleArtifact || state.phase !== 'receipt' || state.dispatch !== 'not-dispatched') {
    throw new DesktopSupabaseBackendReviewError('review-failed')
  }
  return visibleArtifact
}

function createAppDesktopSupabaseBackendReviewServiceWithOptions(
  options: AppDesktopSupabaseBackendReviewForTestingOptionsV1
): DesktopSupabaseBackendReviewService {
  const pluginStore = options.pluginStore ?? appPluginStore
  const waitForPluginStoreReady =
    options.pluginStoreReady ??
    (options.pluginStore
      ? () => undefined
      : () => (appPluginStore.snapshot().ready ? undefined : appPluginStore.load()))
  const credentials = options.credentialServices ?? appCredentialServices
  const runtime = Object.freeze({
    isDesktop: options.isDesktop ?? isTauri,
    fetcher: options.fetcher,
    now: options.now ?? (() => new Date().toISOString()),
    nextId: options.nextId ?? randomId,
    inspectCatalog: options.inspectCatalog ?? inspectSupabasePgCatalog
  })
  const readCredentialDependency = options.fetcher
    ? { resolveCredential: () => resolveSupabaseManagementPat(credentials) }
    : { resolveCredentialStatus: () => supabaseManagementPatStatus(credentials) }
  const dependencies: DesktopSupabaseBackendReviewDependencies = {
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
    ...readCredentialDependency,
    resolveGrantGeneration: () => resolveSupabaseManagementGrantGeneration(credentials),
    prepareStrictReview: (input) => prepareStrictReview(input, runtime),
    ...options.dependencyOverrides
  }
  return createDesktopSupabaseBackendReviewService(dependencies)
}

/** Production owner: no renderer fetcher or dependency injection crosses this factory. */
export function createAppDesktopSupabaseBackendReviewService(): DesktopSupabaseBackendReviewService {
  return createAppDesktopSupabaseBackendReviewServiceWithOptions({})
}

/** Explicit testing composition. Results remain subject to fresh production-native reinspection. */
export function createAppDesktopSupabaseBackendReviewServiceForTestingV1(
  options: AppDesktopSupabaseBackendReviewForTestingOptionsV1
): DesktopSupabaseBackendReviewService {
  if (typeof options.fetcher !== 'function') {
    throw new TypeError('Testing Supabase Backend review requires an explicit fetcher.')
  }
  return createAppDesktopSupabaseBackendReviewServiceWithOptions(options)
}

export const appDesktopSupabaseBackendReviewService = createAppDesktopSupabaseBackendReviewService()
