import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

import { textInput } from '../shared'

export const surveyColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Survey', '问卷') },
  { field: 'publication_number', label: t('Published version', '发布版本') },
  { field: 'accepting', label: t('Accepting responses', '接受答卷') }
]
export const surveyQuestionColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Survey', '问卷') },
  { field: 'description', label: t('Introduction', '说明'), multiline: true },
  { field: 'rating_prompt', label: t('Rating question · 1 to 5', '评分题 · 1 至 5 分') },
  { field: 'choice_prompt', label: t('Single-choice question', '单选题') },
  { field: 'option_a', label: t('Option 1', '选项 1') },
  { field: 'option_b', label: t('Option 2', '选项 2') },
  { field: 'option_c', label: t('Option 3', '选项 3') },
  { field: 'text_prompt', label: t('Text question', '文字题') }
]
export const surveyResponseColumns: readonly BusinessColumn[] = [
  { field: 'survey_title', label: t('Survey', '问卷') },
  { field: 'publication_number', label: t('Published version', '发布版本') },
  { field: 'rating', label: t('Rating · 1 to 5', '评分 · 1 至 5 分') },
  { field: 'choice', label: t('Selected option', '已选选项') }
]
export const surveyResponseDetails: readonly BusinessColumn[] = [
  ...surveyResponseColumns,
  { field: 'comment', label: t('Text answer', '文字回答'), multiline: true },
  { field: 'created_at', label: t('Submitted at', '提交时间') }
]

export function surveyDraftInputs(edit = false): BusinessInput[] {
  const fields = [
    textInput('title', 'Survey title', '问卷标题', 200),
    { ...textInput('description', 'Introduction', '说明', 2000), required: false },
    textInput('rating_prompt', 'Rating question · 1 to 5', '评分题 · 1 至 5 分', 200),
    textInput('choice_prompt', 'Single-choice question', '单选题', 200),
    textInput('option_a', 'Option 1', '选项 1', 200),
    textInput('option_b', 'Option 2', '选项 2', 200),
    textInput('option_c', 'Option 3', '选项 3', 200),
    textInput('text_prompt', 'Text question', '文字题', 200)
  ]
  return fields.map((field) => ({
    ...field,
    required: false,
    ...(edit ? { fromSelection: field.key } : {})
  }))
}

export function surveyAnswerInputs(): BusinessInput[] {
  return [
    {
      key: 'rating',
      label: t('Rating · 1 to 5', '评分 · 1 至 5 分'),
      kind: 'number',
      min: 1,
      max: 5,
      initial: 3
    },
    {
      key: 'choice',
      label: t('Single-choice option number · 1, 2 or 3', '单选项编号 · 1、2 或 3'),
      kind: 'number',
      min: 1,
      max: 3,
      initial: 1
    },
    { ...textInput('comment', 'Text answer · optional', '文字回答 · 可选', 2000), required: false }
  ]
}
