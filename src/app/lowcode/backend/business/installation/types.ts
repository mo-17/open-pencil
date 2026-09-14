import type { AppBackendProviderHostStore } from '@/app/plugins/host/backend-provider'

import type { BusinessTemplateId } from '../model/types'
import type { BusinessTemplateEditor } from '../types'

/** A display-only review; installing always rechecks the live document and Provider. */
export interface BusinessModuleReview {
  readonly kind: BusinessTemplateId
  readonly status: 'ready' | 'installed' | 'blocked'
  readonly reviewKey: string
  readonly summary: string
  readonly conflicts: readonly string[]
  readonly addedPages: number
  readonly sharedPages: readonly string[]
}

export interface BusinessModuleInstallationOptions {
  readonly editor: BusinessTemplateEditor
  readonly store: AppBackendProviderHostStore
  readonly kind: BusinessTemplateId
  readonly locale?: string
}

export interface BusinessModuleInstallationResult {
  readonly kind: BusinessTemplateId
  readonly pageIds: readonly string[]
  readonly entryPageId: string
  readonly path: string
}

export interface BusinessModuleInstallation {
  readonly review: BusinessModuleReview
  apply(): BusinessModuleInstallationResult
}
