import {
  BACKEND_OIDC_CALLBACK_PATH,
  type BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

import {
  hasPublicDocumentAuthentication,
  isHTTPSKeycloakIssuer,
  isManagedPresetAudience,
  LOCAL_KEYCLOAK_ISSUER,
  MANAGED_BACKEND_PREVIEW_ORIGIN
} from './identity'
import type { ManagedBackendPresetDraft } from './types'

/** Public client import material only. The operator reviews and imports it into their own realm. */
export function buildManagedKeycloakClientConfiguration(
  authentication: BackendHttpAPIOIDCAuthenticationIRV1 | null,
  draft: ManagedBackendPresetDraft
): Record<string, unknown> | null {
  if (
    !hasPublicDocumentAuthentication(authentication) ||
    !isManagedPresetAudience(draft.audience) ||
    (authentication.issuer !== LOCAL_KEYCLOAK_ISSUER &&
      !isHTTPSKeycloakIssuer(authentication.issuer))
  )
    return null
  return {
    clientId: authentication.clientId,
    name: 'OpenPencil managed preview',
    protocol: 'openid-connect',
    enabled: true,
    publicClient: true,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    defaultClientScopes: [
      'basic',
      ...authentication.scopes.filter((scope) => scope === 'profile' || scope === 'email')
    ],
    optionalClientScopes: [],
    redirectUris: [MANAGED_BACKEND_PREVIEW_ORIGIN + BACKEND_OIDC_CALLBACK_PATH],
    webOrigins: [MANAGED_BACKEND_PREVIEW_ORIGIN],
    attributes: { 'pkce.code.challenge.method': 'S256' },
    protocolMappers: [
      {
        name: 'openpencil-preview-audience',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-audience-mapper',
        config: {
          'included.custom.audience': draft.audience,
          'access.token.claim': 'true',
          'id.token.claim': 'false'
        }
      }
    ]
  }
}
