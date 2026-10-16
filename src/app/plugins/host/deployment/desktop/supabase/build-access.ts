import {
  resolveSupabaseManagementDatabaseWritePat,
  resolveSupabaseManagementGrantGeneration,
  resolveSupabaseManagementPat,
  supabaseManagementPatStatus
} from '@/app/lowcode/supabase/credentials'
import { createSupabaseStagingTargetStore } from '@/app/lowcode/supabase/staging-target'
import { appPluginStore } from '@/app/plugins/app'
import {
  prepareAppBackendProviderDocumentBuild,
  resolveAppBackendProviderReleaseAuthority,
  type AppBackendProviderBuildOptions,
  type AppBackendProviderDocumentGraph,
  type AppBackendProviderHostStore,
  type PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'
import { appCredentialServices } from '@/app/settings/credentials/app'
import type { CredentialServices } from '@/app/settings/credentials/services'

interface BuildAccessOptions {
  readonly pluginStore?: AppBackendProviderHostStore
  readonly pluginStoreReady?: () => unknown | Promise<unknown>
}

/** Resolve each build against the current store load, including reloads after construction. */
export function createDesktopSupabaseBuildAccess(options: BuildAccessOptions) {
  const pluginStore = options.pluginStore ?? appPluginStore
  const waitForReady =
    options.pluginStoreReady ??
    (options.pluginStore
      ? () => undefined
      : () => (appPluginStore.snapshot().ready ? undefined : appPluginStore.load()))
  return {
    async prepareBuild(
      graph: AppBackendProviderDocumentGraph,
      target: AppBackendProviderBuildOptions['target']
    ) {
      await Promise.resolve(waitForReady())
      return prepareAppBackendProviderDocumentBuild(pluginStore, graph, {
        target,
        mode: 'production'
      })
    },
    resolveBackendProviderAuthority(build: PreparedAppBackendProviderBuild) {
      return resolveAppBackendProviderReleaseAuthority(pluginStore, build.descriptor)
    }
  }
}

export function createDesktopSupabaseStagingAccess(options: {
  readonly readFetcher?: unknown
  readonly credentialServices?: CredentialServices
  readonly stagingTargetStore?: Pick<ReturnType<typeof createSupabaseStagingTargetStore>, 'read'>
}) {
  const credentials = options.credentialServices ?? appCredentialServices
  const readCredential = options.readFetcher
    ? { resolveReadCredential: () => resolveSupabaseManagementPat(credentials) }
    : { resolveReadCredentialStatus: () => supabaseManagementPatStatus(credentials) }
  return {
    ...readCredential,
    resolveWriteCredential: () => resolveSupabaseManagementDatabaseWritePat(credentials),
    resolveGrantGeneration: () => resolveSupabaseManagementGrantGeneration(credentials),
    resolveStagingTargetBinding: () =>
      (options.stagingTargetStore ?? createSupabaseStagingTargetStore()).read()
  }
}
