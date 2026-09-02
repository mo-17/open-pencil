import type { SupabaseInspectedMigrationSnapshotV1 } from '@open-pencil/compiler/backend'

import {
  resolveSupabaseManagementGrantGeneration,
  resolveSupabaseManagementPat
} from '@/app/lowcode/supabase/credentials'
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
import { createIdbBackendHostReleaseDispatchJournal } from './backend/release-journal'
import {
  createDesktopSupabaseBackendReviewService,
  DesktopSupabaseBackendReviewError,
  type DesktopSupabaseBackendReviewDependencies,
  type DesktopSupabaseBackendReviewService,
  type DesktopSupabaseStrictReviewInput
} from './desktop-supabase-backend-review'
import {
  createSupabaseBackendRelease,
  type SupabaseBackendReleaseReviewArtifactV1
} from './supabase/backend-release'
import {
  createSupabaseManagementPgCatalogTransport,
  type SupabaseManagementDesktopFetch
} from './supabase/management-pg-catalog-transport'
import { inspectSupabasePgCatalog } from './supabase/pg-catalog-inspector'

type MaybePromise<T> = T | Promise<T>

export interface AppDesktopSupabaseBackendReviewOptions {
  readonly isDesktop?: () => boolean
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

async function prepareStrictReview(
  input: DesktopSupabaseStrictReviewInput,
  options: Readonly<{
    isDesktop: () => boolean
    fetcher: SupabaseManagementDesktopFetch
    now: () => string
    nextId: () => string
    inspectCatalog: typeof inspectSupabasePgCatalog
  }>
): Promise<SupabaseBackendReleaseReviewArtifactV1> {
  if (!options.isDesktop()) throw new DesktopSupabaseBackendReviewError('desktop-required')
  const transport = createSupabaseManagementPgCatalogTransport({
    personalAccessToken: input.personalAccessToken,
    fetcher: options.fetcher,
    signal: input.signal
  })
  const projectAuthority = await transport.getProjectAuthority({
    projectRef: input.projectRef,
    grantGeneration: input.grantGeneration
  })
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

export function createAppDesktopSupabaseBackendReviewService(
  options: AppDesktopSupabaseBackendReviewOptions = {}
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
    fetcher: options.fetcher ?? tauriFetch,
    now: options.now ?? (() => new Date().toISOString()),
    nextId: options.nextId ?? randomId,
    inspectCatalog: options.inspectCatalog ?? inspectSupabasePgCatalog
  })
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
    resolveCredential: () => resolveSupabaseManagementPat(credentials),
    resolveGrantGeneration: () => resolveSupabaseManagementGrantGeneration(credentials),
    prepareStrictReview: (input) => prepareStrictReview(input, runtime),
    ...options.dependencyOverrides
  }
  return createDesktopSupabaseBackendReviewService(dependencies)
}

export const appDesktopSupabaseBackendReviewService = createAppDesktopSupabaseBackendReviewService()
