import { SURVEY_ROLES } from '@/app/lowcode/backend/business/model/surveys/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage, formAction, selectedParameter } from '../shared'
import {
  surveyAnswerInputs,
  surveyColumns,
  surveyQuestionColumns,
  surveyResponseColumns,
  surveyResponseDetails
} from './fields'
import { surveyDraftManagement, surveyResponseManagement } from './management'

export function surveysDefinition(): BusinessTemplateDefinition {
  return {
    id: 'survey-forms',
    title: t('Surveys and information collection', '问卷与信息收集'),
    description: t(
      'Publish versioned surveys with three fixed question types, collect one final response per account and version, and review private response details. Arbitrary form design, anonymous submissions and aggregate analytics are not included.',
      '发布固定三类题目的版本化问卷，每账号每版本提交一份最终答卷，并查看私人答卷明细。首版不含任意表单设计、匿名提交和聚合分析。'
    ),
    entryPage: 'survey-versions',
    roles: SURVEY_ROLES,
    pages: [
      accountSetupPage(SURVEY_ROLES),
      {
        id: 'survey-versions',
        path: '/surveys',
        title: t('Published surveys', '已发布问卷'),
        public: true,
        description: t(
          'Read the fixed questions and their version number. Sign in and open Answer a survey to respond. Closed versions remain readable.',
          '查看固定题目及发布版本号。登录后前往填写问卷页回答，已关闭版本仍可阅读。'
        ),
        listing: { resourceId: 'survey-versions', columns: surveyColumns, search: true },
        details: surveyQuestionColumns,
        actions: []
      },
      {
        id: 'survey-answer',
        path: '/surveys/respond',
        title: t('Answer a survey', '填写问卷'),
        description: t(
          'Select an open version and read its questions. Rate from 1 to 5, choose option number 1, 2 or 3, and optionally enter a text answer. One final response per verified account and version; it cannot be edited, deleted or resubmitted.',
          '选择开放版本并阅读题目。评分范围为 1 至 5，单选项编号为 1、2 或 3，可填写文字回答。每个已验证账号每版本仅能提交一份最终答卷，提交后不可修改、删除或重复提交。'
        ),
        listing: {
          resourceId: 'survey-versions',
          columns: surveyColumns,
          search: true,
          filter: {
            field: 'accepting',
            choices: [
              { value: true, label: t('Open', '开放') },
              { value: false, label: t('Closed', '关闭') }
            ]
          }
        },
        details: surveyQuestionColumns,
        actions: [
          formAction({
            id: 'submit-survey-response',
            en: 'Submit final response',
            zh: '提交最终答卷',
            inputs: surveyAnswerInputs(),
            parameters: { versionId: selectedParameter() },
            when: { field: 'accepting', values: [true] }
          })
        ]
      },
      {
        id: 'survey-my-responses',
        path: '/surveys/mine',
        title: t('My survey responses', '我的答卷'),
        description: t(
          'Only your own submitted answers appear here. They remain available after the version closes and cannot be changed. The linked question snapshot identifies exactly what you answered.',
          '这里只显示本人提交的答卷，版本关闭后仍可查看且不可更改。关联题目快照保留当时回答的具体内容。'
        ),
        listing: { resourceId: 'survey-responses', columns: surveyResponseColumns },
        details: surveyResponseDetails,
        related: [
          {
            resourceId: 'survey-versions',
            foreignKey: 'id',
            selectionField: 'version_id',
            title: t('Question snapshot', '题目快照'),
            columns: surveyQuestionColumns
          }
        ],
        actions: []
      },
      surveyDraftManagement(),
      surveyResponseManagement()
    ]
  }
}
