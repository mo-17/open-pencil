import type { BusinessTemplateId } from '../model/types'
import type { BusinessText } from '../types'

export interface BusinessPageReference {
  readonly pageId: string
  readonly path: string
}

export interface BusinessNavigationEntry {
  readonly key: string
  readonly label: BusinessText
  readonly path: string
}

export interface BusinessModulePageOptions {
  readonly locale?: string
  readonly shared?: {
    readonly login: BusinessPageReference
    readonly account?: BusinessPageReference
  }
  readonly existingNavigation?: readonly BusinessNavigationEntry[]
  readonly existingPageIds?: readonly string[]
  readonly resourceBindings?: Readonly<Record<string, string>>
}

export interface BusinessModulePagePlan {
  readonly kind: BusinessTemplateId
  readonly paths: Readonly<Record<string, string>>
  readonly navigation: readonly BusinessNavigationEntry[]
  readonly addedPages: number
  readonly navigationChanges: readonly {
    readonly pageId: string
    readonly strategy: 'append-marked' | 'append-entry'
    readonly addedLinks: number
  }[]
}
