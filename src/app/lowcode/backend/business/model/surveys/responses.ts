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
import { SURVEY_RESPONSE_FIELDS, SURVEY_VERSION_FIELDS, type SurveyEntities } from './fields'

/** Closing and submitting lock the same published version before any mutation. */
export function surveyResponseCommands(entities: SurveyEntities) {
  const read = () =>
    businessRead(
      entities.versions,
      'published',
      businessParameter('versionId'),
      SURVEY_VERSION_FIELDS
    )
  const accepting = () =>
    businessAssert(
      'accepting_responses',
      businessResult('published', 'accepting'),
      businessLiteral(true)
    )
  return [
    businessCommand(
      'close-survey-version',
      'Close this version without changing its questions or existing answers',
      { kind: 'role', roleId: 'survey-manager' },
      [businessUUIDParameter('versionId')],
      [
        read(),
        accepting(),
        businessUpdate(
          entities.versions,
          'published',
          'closed',
          [{ field: 'accepting', value: businessLiteral(false) }],
          SURVEY_VERSION_FIELDS
        )
      ],
      { resultName: 'closed', fields: SURVEY_VERSION_FIELDS }
    ),
    businessCommand(
      'submit-survey-response',
      'Submit once per verified account and published version; answers are final',
      {
        kind: 'row-policy',
        entityId: entities.versions.id,
        parameter: 'versionId',
        policyIds: ['accepting-survey-versions']
      },
      [
        businessUUIDParameter('versionId'),
        { name: 'rating', type: 'integer', required: true, min: 1, max: 5 },
        { name: 'choice', type: 'integer', required: true, min: 1, max: 3 },
        businessStringParameter('comment', 2000)
      ],
      [
        read(),
        accepting(),
        businessInsert(
          entities.responses,
          'response',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'version_id', value: businessResult('published', 'id') },
            { field: 'survey_title', value: businessResult('published', 'title') },
            {
              field: 'publication_number',
              value: businessResult('published', 'publication_number')
            },
            ...['rating', 'choice', 'comment'].map((field) => ({
              field,
              value: businessParameter(field)
            }))
          ],
          SURVEY_RESPONSE_FIELDS
        )
      ],
      { resultName: 'response', fields: SURVEY_RESPONSE_FIELDS }
    )
  ]
}
