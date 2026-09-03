import { createSupabaseSourceMigrationBundle } from '@open-pencil/compiler/backend'

import { appPluginStore } from '@/app/plugins/app'
import { isTauri } from '@/app/tauri/env'

import {
  prepareAppBackendProviderDocumentBuild,
  resolveAppBackendProviderReleaseAuthority,
  type AppBackendProviderHostStore
} from '../backend-provider'
import { archiveProjectFiles } from '../project-archive'
import { choosePluginFileExportDestination } from '../source-exporter-runtime'
import {
  createDesktopSupabaseSourceMigrationExportService,
  DesktopSupabaseSourceMigrationExportError,
  type DesktopSupabaseSourceMigrationExportDependencies,
  type DesktopSupabaseSourceMigrationExportService
} from './desktop-supabase-source-migration-export'

type MaybePromise<T> = T | Promise<T>

export interface AppDesktopSupabaseSourceMigrationExportOptions {
  readonly isDesktop?: () => boolean
  readonly pluginStore?: AppBackendProviderHostStore
  /** Resolve current Store loading, including reloads begun after service construction. */
  readonly pluginStoreReady?: () => MaybePromise<unknown>
  readonly now?: () => string
  readonly nextId?: () => string
  readonly dependencyOverrides?: Partial<DesktopSupabaseSourceMigrationExportDependencies>
}

function randomId(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new DesktopSupabaseSourceMigrationExportError('export-failed')
  }
  return crypto.randomUUID()
}

/** Real App wiring remains credential-free and exposes only an explicit ZIP save capability. */
export function createAppDesktopSupabaseSourceMigrationExportService(
  options: AppDesktopSupabaseSourceMigrationExportOptions = {}
): DesktopSupabaseSourceMigrationExportService {
  const pluginStore = options.pluginStore ?? appPluginStore
  const waitForPluginStoreReady =
    options.pluginStoreReady ??
    (options.pluginStore
      ? () => undefined
      : () => (appPluginStore.snapshot().ready ? undefined : appPluginStore.load()))
  const dependencies: DesktopSupabaseSourceMigrationExportDependencies = {
    isDesktop: options.isDesktop ?? isTauri,
    now: options.now ?? (() => new Date().toISOString()),
    nextId: options.nextId ?? randomId,
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
    createBundle: createSupabaseSourceMigrationBundle,
    archive: archiveProjectFiles,
    chooseDestination(fileName, signal) {
      return choosePluginFileExportDestination(
        fileName,
        'Supabase source migration bundle',
        '.zip',
        'application/zip',
        signal
      )
    },
    ...options.dependencyOverrides
  }
  return createDesktopSupabaseSourceMigrationExportService(dependencies)
}

export const appDesktopSupabaseSourceMigrationExportService =
  createAppDesktopSupabaseSourceMigrationExportService()
