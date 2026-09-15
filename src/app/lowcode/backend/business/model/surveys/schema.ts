import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import { addBusinessEntity, businessField, linkBusinessOwner } from '../entities'
import { SURVEY_QUESTION_FIELDS, type SurveyEntities } from './fields'
import { addSurveyPermissions } from './permissions'

export function createSurveyEntities(application: BackendApplicationSpecV1): SurveyEntities {
  addBusinessUsers(application, [])
  const questions = () => SURVEY_QUESTION_FIELDS.map((field) => businessField(field, 'string'))
  const drafts = addBusinessEntity(application, 'survey_drafts', [
    ...questions(),
    businessField('publication_count', 'integer', 0),
    businessField('version', 'integer', 0)
  ])
  const versions = addBusinessEntity(application, 'survey_versions', [
    businessField('draft_id', 'uuid'),
    ...questions(),
    businessField('publication_number', 'integer', 1),
    businessField('accepting', 'boolean', true)
  ])
  linkBusinessOwner(versions, 'draft_id', drafts)
  versions.uniques?.push({
    id: 'one-publication-number',
    fields: ['draft_id', 'publication_number']
  })
  const responses = addBusinessEntity(application, 'survey_responses', [
    businessField('version_id', 'uuid'),
    businessField('survey_title', 'string'),
    businessField('publication_number', 'integer', 1),
    businessField('rating', 'integer', 1),
    businessField('choice', 'integer', 1),
    businessField('comment', 'string')
  ])
  responses.uniques?.push({
    id: 'one-response-per-account-version',
    fields: ['owner_id', 'version_id']
  })
  responses.foreignKeys = [
    {
      id: 'published-version',
      fields: ['version_id'],
      targetEntityId: versions.id,
      targetFields: ['id'],
      onDelete: 'restrict'
    }
  ]
  responses.indexes?.push({
    id: 'version-created',
    fields: ['version_id', 'created_at', 'id'],
    order: 'desc'
  })
  const entities = { drafts, versions, responses }
  addSurveyPermissions(application, entities)
  return entities
}
