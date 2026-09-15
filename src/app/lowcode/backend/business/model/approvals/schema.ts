import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { APPROVALS_KINDS, APPROVALS_STATUSES, type ApprovalEntities } from './fields'
import { approvalsPermissions } from './permissions'

export function createApprovalEntities(app: BackendApplicationSpecV1): ApprovalEntities {
  const users = addBusinessUsers(app, [])
  businessEnum(app, 'oa-request-kind', APPROVALS_KINDS)
  businessEnum(app, 'oa-request-status', APPROVALS_STATUSES)
  const requests = addBusinessEntity(app, 'oa_requests', [
    businessField('applicant_subject', 'uuid'),
    businessEnumField('kind', 'oa-request-kind', 'leave'),
    businessField('title', 'string'),
    businessField('description', 'string'),
    businessField('starts_at', 'datetime', null, true),
    businessField('ends_at', 'datetime', null, true),
    businessField('amount_cents', 'integer', 0),
    businessField('currency', 'string', 'CNY'),
    businessEnumField('status', 'oa-request-status', 'draft'),
    businessField('first_reviewer_subject', 'uuid', null, true),
    businessField('second_reviewer_subject', 'uuid', null, true),
    businessField('submitted_at', 'datetime', null, true),
    businessField('version', 'integer', 0)
  ])
  requests.indexes?.push({
    id: 'approval-queue',
    fields: ['status', 'created_at', 'id'],
    order: 'desc'
  })
  const history = addBusinessEntity(app, 'oa_request_history', [
    businessField('request_id', 'uuid'),
    businessField('actor_subject', 'uuid'),
    businessField('action', 'string'),
    businessField('note', 'string'),
    businessEnumField('before_status', 'oa-request-status', 'draft'),
    businessEnumField('after_status', 'oa-request-status', 'draft'),
    businessField('before_version', 'integer', 0),
    businessField('after_version', 'integer', 0)
  ])
  linkBusinessOwner(history, 'request_id', requests)
  history.uniques?.push({ id: 'request-revision', fields: ['request_id', 'after_version'] })
  history.indexes?.push({
    id: 'request-created',
    fields: ['request_id', 'created_at', 'id'],
    order: 'desc'
  })
  const entities = { users, requests, history }
  approvalsPermissions(app, entities)
  return entities
}
