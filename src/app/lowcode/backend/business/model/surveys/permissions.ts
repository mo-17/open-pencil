import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'
import {
  SURVEY_DRAFT_FIELDS,
  SURVEY_RESPONSE_FIELDS,
  SURVEY_VERSION_FIELDS,
  type SurveyEntities
} from './fields'

export function addSurveyPermissions(
  application: BackendApplicationSpecV1,
  entities: SurveyEntities
): void {
  const manager = { kind: 'role', roleId: 'survey-manager' } as const
  const drafts = businessReadResource(
    application,
    entities.drafts,
    'survey-drafts',
    SURVEY_DRAFT_FIELDS,
    [businessGrant(application, entities.drafts, 'manage-survey-drafts', manager)]
  )
  drafts.query = {
    filterFields: [],
    searchFields: ['title', 'description'],
    sortFields: ['created_at']
  }
  const versions = businessReadResource(
    application,
    entities.versions,
    'survey-versions',
    SURVEY_VERSION_FIELDS,
    [
      businessGrant(application, entities.versions, 'published-survey-versions', {
        kind: 'anonymous'
      })
    ]
  )
  versions.query = {
    filterFields: ['id', 'draft_id', 'accepting'],
    searchFields: ['title', 'description'],
    sortFields: ['created_at']
  }
  application.auth.rowAccess.push({
    id: 'accepting-survey-versions',
    entityId: entities.versions.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'anonymous' },
    conditions: [{ fieldId: 'accepting', value: true }]
  })
  for (const [id, policy] of [
    ['survey-responses', businessOwnerGrant(application, entities.responses)],
    [
      'survey-management-responses',
      businessGrant(application, entities.responses, 'manage-survey-responses', manager)
    ]
  ]) {
    const resource = businessReadResource(
      application,
      entities.responses,
      id,
      SURVEY_RESPONSE_FIELDS,
      [policy]
    )
    resource.query = {
      filterFields: ['version_id', 'rating', 'choice'],
      searchFields: [],
      sortFields: ['created_at']
    }
  }
}
