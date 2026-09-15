import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createHospitalApplication } from '@/app/lowcode/backend/business/model/hospital/application'

export function hospitalAuthentication(): BackendHttpAPIOIDCAuthenticationIRV1 {
  return {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'hospital-fixture',
    scopes: ['openid'],
    callbackPath: '/_openpencil/auth/callback'
  }
}

export function hospitalApplication() {
  return createHospitalApplication('hospital-compiler-fixture', hospitalAuthentication())
}
