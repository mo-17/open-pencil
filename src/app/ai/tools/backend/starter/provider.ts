import { appPluginStore, appPluginStoreReady } from '@/app/plugins'
import { listAppBackendProviderDescriptors } from '@/app/plugins/host/backend-provider'
import { NESTJS_BACKEND_PROVIDER_PLUGIN_ID } from '@/app/plugins/host/nestjs/backend-provider'

import type { BackendStarterAIToolOptions } from './types'

export async function resolveBackendStarterProvider(
  options: BackendStarterAIToolOptions,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  await (options.ready?.() ?? appPluginStoreReady)
  signal?.throwIfAborted()
  const descriptor = listAppBackendProviderDescriptors(options.pluginStore ?? appPluginStore).find(
    (entry) => entry.pluginId === NESTJS_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (!descriptor)
    throw new Error(
      'Enable the installed, host-reviewed NestJS Backend Provider in Settings → Plugins before creating application pages.'
    )
  return descriptor
}
