import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import {
  businessCaller,
  businessCommand,
  businessInsert,
  businessParameter,
  businessStringParameter
} from './commands'
import { addBusinessEntity, businessField } from './entities'
import { businessGrant, businessOwnerGrant, businessReadResource } from './permissions'

export const BUSINESS_USER_FIELDS = ['id', 'title', 'active', 'created_at']

/** Registration records a verified account; it never grants an OIDC role or project membership. */
export function addBusinessUsers(
  application: BackendApplicationSpecV1,
  directoryRoles: readonly string[]
): DataEntityIR {
  const users = addBusinessEntity(application, 'users', [
    businessField('title', 'string'),
    businessField('active', 'boolean', true)
  ])
  users.uniques?.push({ id: 'one-profile-per-account', fields: ['owner_id'] })
  const ownerPolicy = businessOwnerGrant(application, users)
  const policies = [ownerPolicy]
  for (const roleId of directoryRoles)
    policies.push(
      businessGrant(application, users, `${roleId}-directory`, { kind: 'role', roleId })
    )
  const resource = businessReadResource(application, users, 'users', BUSINESS_USER_FIELDS, policies)
  resource.query = { filterFields: ['active'], searchFields: ['title'], sortFields: ['created_at'] }
  businessReadResource(application, users, 'my-profile', BUSINESS_USER_FIELDS, [ownerPolicy])
  application.commands?.commands.push(
    businessCommand(
      'register-business-user',
      'Register my account profile',
      { kind: 'authenticated' },
      [businessStringParameter('title', 100)],
      [
        businessInsert(
          users,
          'profile',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'title', value: businessParameter('title') }
          ],
          BUSINESS_USER_FIELDS
        )
      ],
      { resultName: 'profile', fields: [...BUSINESS_USER_FIELDS] }
    )
  )
  return users
}
