import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createBusinessApplication } from '../model'
import { BUSINESS_TEMPLATE_IDS, type BusinessTemplateId } from '../model/types'
import { conflict, normalized } from './compare'

export const BUSINESS_ACCOUNTS_MODULE_ID = 'shared-accounts'
export const BUSINESS_ACCOUNT_ENTITY_ID = 'business-users'
export const BUSINESS_REGISTRATION_COMMAND_ID = 'register-business-user'

export function selectedBusinessKinds(kinds: readonly BusinessTemplateId[]): BusinessTemplateId[] {
  if (kinds.some((kind) => !BUSINESS_TEMPLATE_IDS.includes(kind)))
    conflict('$.modules', 'The selected business module is not supported.')
  return BUSINESS_TEMPLATE_IDS.filter((kind) => kinds.includes(kind))
}

export function businessModuleSource(
  base: BackendApplicationSpecV1,
  kind: BusinessTemplateId,
  directoryId: string
): BackendApplicationSpecV1 {
  const api = base.httpApi
  const authentication = api?.browserClient?.authentication
  const identity = base.auth.identities.find((entry) => entry.id === api?.authentication.identityId)
  if (!authentication || identity?.kind !== 'user')
    conflict(
      '$.httpApi',
      'Business modules require an existing JWT user identity and public OIDC browser client.'
    )
  const source = createBusinessApplication(base.applicationId, authentication, kind)
  const directory = source.httpApi?.resources.find((entry) => entry.id === 'users')
  if (!directory) conflict('$.httpApi', 'The business module has no account directory.')
  directory.id = directoryId
  directory.path = '/' + directoryId
  return normalized(source)
}

export function directoryBinding(base: BackendApplicationSpecV1, kind: BusinessTemplateId): string {
  const id = kind + '-users'
  return base.httpApi?.resources.some((entry) => entry.id === id) ? id : 'users'
}
