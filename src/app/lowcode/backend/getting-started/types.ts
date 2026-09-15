import type { BusinessTemplateId } from '../business/model/types'

export interface BackendGettingStartedModule {
  readonly kind: BusinessTemplateId
  readonly name: string
  /** Template default only: a canvas route may have been renamed during installation. */
  readonly defaultEntryPath: string
  readonly roles: readonly string[]
  readonly steps: readonly string[]
  readonly boundaries: readonly string[]
}

/** Read-only guidance from the saved Backend declaration, never a deployment or grant result. */
export interface BackendGettingStartedGuide {
  readonly applicationId: string
  readonly authentication: {
    readonly issuer: string
    readonly clientId: string
    readonly callbackPath: string
  }
  readonly modules: readonly BackendGettingStartedModule[]
  readonly roles: readonly string[]
  readonly accountSetup: string
  readonly boundaries: readonly string[]
}
