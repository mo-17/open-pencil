import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const SURVEY_ROLES = ['survey-manager'] as const
export const SURVEY_QUESTION_FIELDS = [
  'title',
  'description',
  'rating_prompt',
  'choice_prompt',
  'option_a',
  'option_b',
  'option_c',
  'text_prompt'
] as const
export const SURVEY_DRAFT_FIELDS = [
  'id',
  ...SURVEY_QUESTION_FIELDS,
  'publication_count',
  'version',
  'created_at'
]
export const SURVEY_VERSION_FIELDS = [
  'id',
  'draft_id',
  ...SURVEY_QUESTION_FIELDS,
  'publication_number',
  'accepting',
  'created_at'
]
export const SURVEY_RESPONSE_FIELDS = [
  'id',
  'version_id',
  'survey_title',
  'publication_number',
  'rating',
  'choice',
  'comment',
  'created_at'
]
export interface SurveyEntities {
  drafts: DataEntityIR
  versions: DataEntityIR
  responses: DataEntityIR
}
