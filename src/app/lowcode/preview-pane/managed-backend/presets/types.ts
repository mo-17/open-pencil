import type { ManagedPreviewConfig } from '@open-pencil/compiler/managed-preview'
import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

export const MANAGED_BACKEND_PRESET_IDS = ['local-keycloak', 'https-keycloak', 'oidc'] as const
export type ManagedBackendPresetId = (typeof MANAGED_BACKEND_PRESET_IDS)[number]
export type ManagedBackendPresetDraft = {
  -readonly [Key in 'audience' | 'jwksURL' | 'caFile']: ManagedPreviewConfig[Key]
}
export type ManagedBackendPresetMissing = 'authentication' | keyof ManagedBackendPresetDraft
export type ManagedBackendPresetIssue =
  | 'document-authentication-required'
  | 'local-keycloak-issuer-required'
  | 'https-keycloak-issuer-required'
  | 'invalid-audience'
  | 'invalid-jwks-url'
  | 'invalid-ca-path'

export interface ManagedBackendPresetInput {
  readonly presetId: ManagedBackendPresetId
  readonly authentication: BackendHttpAPIOIDCAuthenticationIRV1 | null
  readonly draft: ManagedBackendPresetDraft
}

export interface ManagedBackendPresetResolution {
  readonly presetId: ManagedBackendPresetId
  readonly applicable: boolean
  /** Suggestions fill only empty fields. Applying them remains an explicit UI action. */
  readonly patch: Partial<ManagedBackendPresetDraft>
  readonly missing: readonly ManagedBackendPresetMissing[]
  readonly issues: readonly ManagedBackendPresetIssue[]
  /** Configuration completeness only; no service, file or identity provider has been contacted. */
  readonly ready: boolean
}
