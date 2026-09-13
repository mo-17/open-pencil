import {
  BACKEND_OIDC_CALLBACK_PATH,
  type BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

import type { ManagedBackendPresetDraft } from '@/app/lowcode/preview-pane/managed-backend/presets'

export const EMPTY_PRESET_DRAFT: ManagedBackendPresetDraft = Object.freeze({
  audience: '',
  jwksURL: '',
  caFile: ''
})

export function presetAuthentication(
  overrides: Partial<BackendHttpAPIOIDCAuthenticationIRV1> = {}
): BackendHttpAPIOIDCAuthenticationIRV1 {
  return {
    kind: 'oidc-pkce',
    issuer: 'http://127.0.0.1:18080/realms/openpencil',
    clientId: 'notes-public-client',
    scopes: ['openid', 'profile', 'email'],
    callbackPath: BACKEND_OIDC_CALLBACK_PATH,
    ...overrides
  }
}
