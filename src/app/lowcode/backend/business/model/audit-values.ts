import type { BackendCommandValueIR } from '@open-pencil/lowcode/backend'

import { businessCaller, businessLiteral, businessParameter, businessResult } from './commands'

/** Keep the authorized record owner separate from the verified caller who records an event. */
export function businessAuditIdentityValues(
  record: string,
  parentField: string,
  action: string,
  created: boolean
): BackendCommandValueIR[] {
  return [
    { field: 'owner_id', value: created ? businessCaller() : businessResult(record, 'owner_id') },
    { field: parentField, value: businessResult(record, 'id') },
    { field: 'actor_subject', value: businessCaller() },
    { field: 'action', value: businessLiteral(action) },
    { field: 'note', value: created ? businessLiteral('') : businessParameter('note') }
  ]
}
