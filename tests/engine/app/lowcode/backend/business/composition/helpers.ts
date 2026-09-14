import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'
import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'

export const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'business-public-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}

export function business(kind: BusinessTemplateId = 'customer-crm') {
  return createBusinessApplication('existing-business-app', authentication, kind)
}

export function resource(application: BackendApplicationSpecV1, id: string) {
  const value = application.httpApi?.resources.find((entry) => entry.id === id)
  if (!value) throw new Error('Missing fixture resource: ' + id)
  return value
}

export function notes() {
  const base = createNestJSNotesApplication('unrelated-existing-app')
  const client = base.httpApi?.browserClient
  if (!client) throw new Error('Missing fixture browser client')
  client.authentication = structuredClone(authentication)
  return base
}
