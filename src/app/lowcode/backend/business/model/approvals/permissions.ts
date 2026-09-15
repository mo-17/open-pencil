import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'
import {
  APPROVALS_ROLES,
  APPROVALS_KINDS,
  APPROVAL_REQUEST_FIELDS,
  APPROVAL_HISTORY_FIELDS,
  type ApprovalEntities
} from './fields'

export const APPROVAL_COMMAND_POLICIES = ['oa-first-command', 'oa-second-command'] as const

export function approvalsPermissions(
  app: BackendApplicationSpecV1,
  entities: ApprovalEntities
): void {
  const requestQuery = {
    filterFields: ['kind', 'status'],
    searchFields: ['title', 'description'],
    sortFields: ['created_at']
  }
  const historyQuery = {
    filterFields: ['request_id', 'action'],
    searchFields: [],
    sortFields: ['created_at']
  }
  const owner = businessOwnerGrant(app, entities.requests)
  const historyOwner = businessOwnerGrant(app, entities.history)
  businessReadResource(app, entities.requests, 'oa-requests', APPROVAL_REQUEST_FIELDS, [
    owner
  ]).query = requestQuery
  businessReadResource(app, entities.history, 'oa-history', APPROVAL_HISTORY_FIELDS, [
    historyOwner
  ]).query = historyQuery
  for (const kind of APPROVALS_KINDS) {
    const id = `oa-own-${kind}`
    app.auth.rowAccess.push({
      id,
      entityId: entities.requests.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'owner', ownershipId: owner },
      conditions: [{ fieldId: 'kind', value: kind }]
    })
    businessReadResource(app, entities.requests, `oa-${kind}-requests`, APPROVAL_REQUEST_FIELDS, [
      id
    ]).query = requestQuery
  }
  for (const [index, roleId] of APPROVALS_ROLES.entries()) {
    const level = index === 0 ? 'first' : 'second'
    const queuePolicy = `oa-${level}-queue`
    app.auth.rowAccess.push({
      id: queuePolicy,
      entityId: entities.requests.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'role', roleId },
      conditions: [{ fieldId: 'status', value: `pending_${level}` }]
    })
    // Command-only role grants keep replay authorization independent of the new status.
    businessGrant(app, entities.requests, APPROVAL_COMMAND_POLICIES[index], {
      kind: 'role',
      roleId
    })
    businessReadResource(app, entities.requests, `oa-${level}-queue`, APPROVAL_REQUEST_FIELDS, [
      queuePolicy
    ]).query = requestQuery
  }
}
