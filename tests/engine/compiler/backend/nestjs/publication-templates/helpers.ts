import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createAutomotiveApplication } from '@/app/lowcode/backend/business/model/automotive/application'
import { createBlogApplication } from '@/app/lowcode/backend/business/model/blog/application'

export function publicationAuthentication(): BackendHttpAPIOIDCAuthenticationIRV1 {
  return {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'publication-fixture',
    scopes: ['openid'],
    callbackPath: '/_openpencil/auth/callback'
  }
}

export function publicationApplication(kind: 'blog' | 'automotive') {
  const create = kind === 'blog' ? createBlogApplication : createAutomotiveApplication
  return create(kind + '-compiler-fixture', publicationAuthentication())
}
