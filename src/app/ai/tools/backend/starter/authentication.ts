import type { ParamDef } from '@open-pencil/core/tools'
import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

export interface BackendStarterAuthenticationInput {
  readonly authentication: string
  readonly issuer?: string
  readonly client_id?: string
}

export const BACKEND_STARTER_AUTHENTICATION_PARAMS = {
  authentication: {
    type: 'string',
    enum: ['local-keycloak', 'oidc'],
    required: true,
    description:
      "Use local-keycloak only when the user selected the local OpenPencil Keycloak setup; it fixes the public issuer and client ID. Otherwise choose oidc and provide the user's public issuer and client_id."
  },
  issuer: {
    type: 'string',
    description: 'Public OIDC issuer URL, required for oidc. Never pass a token or password.'
  },
  client_id: {
    type: 'string',
    description: 'Public browser OIDC client ID, required for oidc. No client secret.'
  }
} satisfies Record<string, ParamDef>

export function backendStarterAuthentication(
  args: BackendStarterAuthenticationInput
): Pick<BackendHttpAPIOIDCAuthenticationIRV1, 'issuer' | 'clientId'> {
  if (args.authentication === 'local-keycloak') {
    if (args.issuer !== undefined || args.client_id !== undefined)
      throw new Error('The local-keycloak preset cannot override its issuer or client ID.')
    return {
      issuer: 'http://127.0.0.1:18080/realms/openpencil',
      clientId: 'notes-public-client'
    }
  }
  if (args.authentication !== 'oidc') {
    throw new Error('Select local-keycloak or oidc authentication.')
  }
  if (
    typeof args.issuer !== 'string' ||
    args.issuer.length === 0 ||
    args.issuer.length > 2048 ||
    typeof args.client_id !== 'string' ||
    args.client_id.length === 0 ||
    args.client_id.length > 256
  ) {
    throw new Error('Provide a bounded public OIDC issuer and client_id; never provide secrets.')
  }
  return { issuer: args.issuer, clientId: args.client_id }
}
