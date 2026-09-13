import { isTauri } from '@/app/tauri/env'

import { createBrowserPreviewHost, type CreateBrowserPreviewHostOptions } from './browser'
import type { CreateTauriPreviewHostOptions } from './tauri'
import type { PreviewHost, PreviewTarget } from './types'

export interface CreatePreviewHostOptions {
  localBackend?: PreviewLocalBackendConnection
  environment?: 'browser' | 'tauri'
  browser?: CreateBrowserPreviewHostOptions
  tauri?: CreateTauriPreviewHostOptions
}

export async function createPreviewHost(
  target: PreviewTarget,
  options: CreatePreviewHostOptions = {}
): Promise<PreviewHost> {
  const environment = options.environment ?? (isTauri() ? 'tauri' : 'browser')
  if (environment === 'browser') {
    if (options.localBackend) throw new Error('Local NestJS preview requires the desktop editor.')
    return createBrowserPreviewHost(target, options.browser)
  }
  const { createTauriPreviewHost } = await import('./tauri')
  return createTauriPreviewHost(target, {
    ...options.tauri,
    ...(options.localBackend ? { localBackend: options.localBackend } : {})
  })
}
import type { PreviewLocalBackendConnection } from '@open-pencil/compiler/preview-local-backend'
