import type { BackendApplicationSpecV1, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import type { BusinessTemplateId } from '../model/types'

export interface BusinessCompositionOptions {
  /** Explicitly recognize unchanged standalone templates before installing other modules. */
  adoptExisting?: readonly BusinessTemplateId[]
}

export interface BusinessCompositionResult {
  application: BackendApplicationSpecV1
  installedKinds: BusinessTemplateId[]
  addedKinds: BusinessTemplateId[]
  adoptedKinds: BusinessTemplateId[]
  addedEntities: string[]
  sharedAccountWasPresent: boolean
  bindings: Partial<Record<BusinessTemplateId, Readonly<Record<string, string>>>>
  diagnostics: BackendDiagnostic[]
}

export type BusinessCompositionPreview =
  | ({ ok: true } & BusinessCompositionResult)
  | { ok: false; diagnostics: BackendDiagnostic[] }

export class BusinessCompositionError extends Error {
  constructor(readonly diagnostics: BackendDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join(' '))
    this.name = 'BusinessCompositionError'
  }
}
