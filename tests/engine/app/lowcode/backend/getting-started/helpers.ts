import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'

export const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com/real-issuer',
  clientId: 'saved-public-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}

export const enterpriseKinds = [
  'customer-crm',
  'asset-management',
  'quote-contracts',
  'recruitment-hr'
] as const

export function business(kind: BusinessTemplateId = 'customer-crm'): BackendApplicationSpecV1 {
  return createBusinessApplication('getting-started-app', authentication, kind)
}

export function enterprise(): BackendApplicationSpecV1 {
  return composeBusinessModules(business(), enterpriseKinds, {
    adoptExisting: ['customer-crm']
  }).application
}

export function changeRoleReferences(
  application: BackendApplicationSpecV1,
  before: string,
  after: string
): void {
  for (const command of application.commands?.commands ?? [])
    if ('roleId' in command.access && command.access.roleId === before)
      command.access.roleId = after
  for (const policy of application.auth.rowAccess)
    if ('roleId' in policy.principal && policy.principal.roleId === before)
      policy.principal.roleId = after
}
