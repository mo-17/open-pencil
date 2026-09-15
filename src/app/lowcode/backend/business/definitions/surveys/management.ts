import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import {
  surveyColumns,
  surveyDraftInputs,
  surveyQuestionColumns,
  surveyResponseDetails
} from './fields'

export function surveyDraftManagement(): BusinessPageDefinition {
  return {
    id: 'survey-drafts',
    path: '/surveys/manage/drafts',
    title: t('Survey drafts', '问卷草稿管理'),
    description: t(
      'survey-manager edits drafts for a fixed rating, three-option single choice and optional text answer. Publishing copies the questions into a new immutable version; edits never change earlier versions. This is not a dynamic form designer.',
      'survey-manager 管理固定评分、三选一单选及可选文字回答的题面。发布会复制为新的不可变题目版本，编辑草稿不会更改旧版本。本模板不是任意动态表单设计器。'
    ),
    listing: {
      resourceId: 'survey-drafts',
      search: true,
      columns: [
        { field: 'title', label: t('Survey', '问卷') },
        { field: 'publication_count', label: t('Published versions', '已发布版本数') }
      ]
    },
    details: surveyQuestionColumns,
    related: [
      {
        resourceId: 'survey-versions',
        foreignKey: 'draft_id',
        title: t('Published versions', '已发布版本'),
        columns: surveyColumns
      }
    ],
    actions: [
      formAction({
        id: 'create-survey-draft',
        en: 'Create survey draft',
        zh: '新建问卷草稿',
        inputs: surveyDraftInputs()
      }),
      formAction({
        id: 'update-survey-draft',
        en: 'Edit survey draft',
        zh: '编辑问卷草稿',
        inputs: surveyDraftInputs(true),
        parameters: { draftId: selectedParameter() }
      }),
      formAction({
        id: 'publish-survey-version',
        en: 'Publish new version',
        zh: '发布新版本',
        inputs: [],
        parameters: { draftId: selectedParameter() },
        description: t(
          'Review every question and option. Publication makes this snapshot publicly readable and open for signed-in responses. All question fields except the introduction must be non-empty.',
          '请核对每道题和选项。发布后该题目版本可公开阅读并接受登录用户答卷，除说明外所有题面字段均须填写。'
        )
      })
    ]
  }
}

export function surveyResponseManagement(): BusinessPageDefinition {
  return {
    id: 'survey-management',
    path: '/surveys/manage/responses',
    title: t('Manage survey responses', '问卷答卷管理'),
    description: t(
      'survey-manager selects a published version to inspect its private response records. Closing only stops further submissions; questions and submitted answers remain unchanged. No aggregate statistics or editing of answers is provided.',
      'survey-manager 选择发布版本查看私人答卷明细。关闭仅停止后续提交，题目及已提交答案保持不变。首版不提供汇总统计或修改答卷。'
    ),
    listing: { resourceId: 'survey-versions', columns: surveyColumns, search: true },
    details: surveyQuestionColumns,
    related: [
      {
        resourceId: 'survey-management-responses',
        foreignKey: 'version_id',
        title: t('Response details', '答卷明细'),
        columns: surveyResponseDetails
      }
    ],
    actions: [
      formAction({
        id: 'close-survey-version',
        en: 'Close this version',
        zh: '关闭此版本',
        inputs: [],
        parameters: { versionId: selectedParameter() },
        when: { field: 'accepting', values: [true] },
        description: t(
          'This version cannot reopen. It stays readable and existing answers remain available to their owners and survey managers. Publish a new version for another collection round.',
          '此版本关闭后不可重新开放，题目仍可阅读，既有答卷仅本人及问卷管理员可见。再次收集请发布新版本。'
        )
      })
    ]
  }
}
