import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult
} from '../commands'
import { publicationHistoryValues } from '../publication-history'
import type { MediaDomain } from './fields'

export function mediaAccess(domain: MediaDomain): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: domain.entity.id,
    parameter: domain.parameter,
    policyIds: [...domain.managementPolicies]
  }
}

export function readMedia(domain: MediaDomain): BackendCommandStepIR {
  return businessRead(domain.entity, 'media', businessParameter(domain.parameter), [
    'owner_id',
    ...domain.fields
  ])
}

export function mediaRevision(record = 'media'): BackendCommandValueIR {
  return {
    field: 'version',
    value: {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: businessResult(record, 'version'),
      right: businessLiteral(1)
    }
  }
}

export function mediaHistory(
  domain: MediaDomain,
  action: string,
  after: BackendCommandLeafIR = businessResult('media', 'status'),
  created = false
): BackendCommandStepIR {
  return businessInsert(
    domain.history,
    'history',
    publicationHistoryValues('media', domain.parentField, action, after, created),
    domain.historyFields
  )
}

export function mediaStatus(status: string, operator: 'eq' | 'neq' = 'eq'): BackendCommandStepIR {
  return businessAssert(
    `${operator}_${status}`,
    businessResult('media', 'status'),
    businessLiteral(status),
    operator
  )
}

export function mediaPlaybackReady(): BackendCommandStepIR {
  return businessAssert(
    'playback_configured',
    businessResult('media', 'playback_url'),
    businessLiteral(''),
    'neq'
  )
}
