import type { BackendCommandParameterIR, BackendCommandValueIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import {
  SURVEY_DRAFT_FIELDS,
  SURVEY_QUESTION_FIELDS,
  SURVEY_VERSION_FIELDS,
  type SurveyEntities
} from './fields'

export function surveyQuestionParameters(): BackendCommandParameterIR[] {
  return SURVEY_QUESTION_FIELDS.map((field) =>
    businessStringParameter(field, field === 'description' ? 2000 : 200)
  )
}
function questionValues(source: 'parameter' | 'draft'): BackendCommandValueIR[] {
  return SURVEY_QUESTION_FIELDS.map((field) => ({
    field,
    value: source === 'parameter' ? businessParameter(field) : businessResult('draft', field)
  }))
}
function increment(field: string): BackendCommandValueIR {
  return {
    field,
    value: {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: businessResult('draft', field),
      right: businessLiteral(1)
    }
  }
}
export function surveyDraftCommands(entities: SurveyEntities) {
  const access = { kind: 'role', roleId: 'survey-manager' } as const
  const read = () =>
    businessRead(entities.drafts, 'draft', businessParameter('draftId'), [
      'owner_id',
      ...SURVEY_DRAFT_FIELDS
    ])
  return [
    businessCommand(
      'create-survey-draft',
      'Create a fixed three-question survey draft',
      access,
      surveyQuestionParameters(),
      [
        businessInsert(
          entities.drafts,
          'draft',
          [{ field: 'owner_id', value: businessCaller() }, ...questionValues('parameter')],
          SURVEY_DRAFT_FIELDS
        )
      ],
      { resultName: 'draft', fields: SURVEY_DRAFT_FIELDS }
    ),
    businessCommand(
      'update-survey-draft',
      'Edit a draft without changing published versions',
      access,
      [businessUUIDParameter('draftId'), ...surveyQuestionParameters()],
      [
        read(),
        businessUpdate(
          entities.drafts,
          'draft',
          'updated',
          [...questionValues('parameter'), increment('version')],
          SURVEY_DRAFT_FIELDS
        )
      ],
      { resultName: 'updated', fields: SURVEY_DRAFT_FIELDS }
    ),
    businessCommand(
      'publish-survey-version',
      'Publish an immutable question snapshot as a new version',
      access,
      [businessUUIDParameter('draftId')],
      [
        read(),
        ...SURVEY_QUESTION_FIELDS.filter((field) => field !== 'description').map((field) =>
          businessAssert(
            `required_${field}`,
            businessResult('draft', field),
            businessLiteral(''),
            'neq'
          )
        ),
        businessUpdate(
          entities.drafts,
          'draft',
          'numbered',
          [increment('publication_count')],
          SURVEY_DRAFT_FIELDS
        ),
        businessInsert(
          entities.versions,
          'published',
          [
            { field: 'owner_id', value: businessResult('draft', 'owner_id') },
            { field: 'draft_id', value: businessResult('draft', 'id') },
            ...questionValues('draft'),
            { field: 'publication_number', value: businessResult('numbered', 'publication_count') }
          ],
          SURVEY_VERSION_FIELDS
        )
      ],
      { resultName: 'published', fields: SURVEY_VERSION_FIELDS }
    )
  ]
}
