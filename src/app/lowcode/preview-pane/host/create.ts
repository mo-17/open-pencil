import { isTauri } from '@/app/tauri/env'

import { createBrowserPreviewHost, type CreateBrowserPreviewHostOptions } from './browser'
import type { CreateTauriPreviewHostOptions } from './tauri'
import type { PreviewHost, PreviewTarget } from './types'

export interface CreatePreviewHostOptions {
  environment?: 'browser' | 'tauri'
  browser?: CreateBrowserPreviewHostOptions
  tauri?: CreateTauriPreviewHostOptions
}

export async function createPreviewHost(
  target: PreviewTarget,
  options: CreatePreviewHostOptions = {}
): Promise<PreviewHost> {
  const environment = options.environment ?? (isTauri() ? 'tauri' : 'browser')
  if (environment === 'browser') return createBrowserPreviewHost(target, options.browser)
  const { createTauriPreviewHost } = await import('./tauri')
  return createTauriPreviewHost(target, options.tauri)
}
