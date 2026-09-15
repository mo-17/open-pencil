import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult
} from '../commands'
import {
  COMMUNITY_MODERATION_FIELDS,
  COMMUNITY_POST_FIELDS,
  type CommunityEntities
} from './fields'

export function readCommunityPost(entities: CommunityEntities) {
  return businessRead(entities.posts, 'post', businessParameter('postId'), [
    ...COMMUNITY_POST_FIELDS,
    ...COMMUNITY_MODERATION_FIELDS
  ])
}
export const communityStatus = (record: string, expected: string) =>
  businessAssert(
    `expected_${record}_status`,
    businessResult(record, 'status'),
    businessLiteral(expected)
  )
export const communityNonempty = (parameter: string) =>
  businessAssert(`nonempty_${parameter}`, businessParameter(parameter), businessLiteral(''), 'neq')
export const communityVersionParameter = (): BackendCommandParameterIR => ({
  name: 'expectedVersion',
  type: 'integer',
  required: true,
  min: 0,
  max: 2147483646
})
export const communityVersionCheck = (record: string) =>
  businessAssert(
    'unchanged_content',
    businessResult(record, 'version'),
    businessParameter('expectedVersion')
  )
export function communityRevision(record: string): BackendCommandValueIR {
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
export function communityPostAccess(
  entities: CommunityEntities,
  openOnly = false
): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: entities.posts.id,
    parameter: 'postId',
    policyIds: openOnly
      ? ['community-posts-published']
      : ['community-posts-published', 'community-posts-closed']
  }
}
export function moderationValues(status: string, reviewed: boolean): BackendCommandValueIR[] {
  return [
    { field: 'status', value: businessLiteral(status) },
    { field: 'moderation_note', value: reviewed ? businessParameter('note') : businessLiteral('') },
    { field: 'reviewed_at', value: reviewed ? { kind: 'server-now' } : businessLiteral(null) }
  ]
}
