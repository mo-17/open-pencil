import { createSupabaseSourceMigrationBundle } from '@open-pencil/compiler/backend'

import { type AppBackendProviderHostStore } from '@/app/plugins/host/backend-provider'
import { createDesktopSupabaseBuildAccess } from '@/app/plugins/host/deployment/desktop/supabase/build-access'
import { archiveProjectFiles } from '@/app/plugins/host/project-archive'
import { choosePluginFileExportDestination } from '@/app/plugins/host/source-exporter-runtime'
import { isTauri } from '@/app/tauri/env'

import {
  createDesktopSupabaseSourceMigrationExportService,
  DesktopSupabaseSourceMigrationExportError,
  type DesktopSupabaseSourceMigrationExportDependencies,
  type DesktopSupabaseSourceMigrationExportService
} from './export'

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
  const buildAccess = createDesktopSupabaseBuildAccess(options)
  const dependencies: DesktopSupabaseSourceMigrationExportDependencies = {
    isDesktop: options.isDesktop ?? isTauri,
    now: options.now ?? (() => new Date().toISOString()),
    nextId: options.nextId ?? randomId,
    ...buildAccess,
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
