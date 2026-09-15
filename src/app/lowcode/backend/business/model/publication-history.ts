import type { BackendCommandLeafIR, BackendCommandValueIR } from '@open-pencil/lowcode/backend'

import { businessAuditIdentityValues } from './audit-values'
import { businessLiteral, businessResult } from './commands'

/** Audit snapshots keep the content owner distinct from the acting publisher. */
export function publicationHistoryValues(
  record: string,
  parentField: string,
  action: string,
  after: BackendCommandLeafIR,
  created: boolean
): BackendCommandValueIR[] {
  return [
    ...businessAuditIdentityValues(record, parentField, action, created),
    {
      field: 'before_status',
      value: created ? businessLiteral('draft') : businessResult(record, 'status')
    },
    { field: 'after_status', value: after }
  ]
}
