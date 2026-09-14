import type { AppBackendProviderHostStore } from '@/app/plugins/host/backend-provider'

/** Host dependencies shared by the reviewed Backend application starters. */
export interface BackendStarterAIToolOptions {
  readonly pluginStore?: AppBackendProviderHostStore
  readonly ready?: () => Promise<void>
}
