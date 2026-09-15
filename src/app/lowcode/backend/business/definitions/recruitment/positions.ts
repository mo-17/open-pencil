import {
  businessText as t,
  type BusinessInput,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import { hrCandidateColumns, hrNote, hrPositionColumns } from './fields'

function positionInputs(edit = false): BusinessInput[] {
  return [
    textInput('title', 'Position title', '职位名称', 200),
    textInput('department', 'Department', '部门', 100),
    {
      ...textInput('description', 'Requirements · plain text', '岗位要求 · 纯文本', 2000),
      required: false
    },
    {
      key: 'active',
      label: t('Accepting candidates', '接受候选人'),
      kind: 'select' as const,
      initial: 'true',
      choices: [
        { value: true, label: t('Open', '开放') },
        { value: false, label: t('Closed', '关闭') }
      ]
    }
  ].map((field) => ({ ...field, ...(edit ? { fromSelection: field.key } : {}) }))
}
export function hrPositionsPage(): BusinessPageDefinition {
  return {
    id: 'hr-positions',
    path: '/hr/positions',
    title: t('My recruitment positions', '我负责的招聘职位'),
    description: t(
      'Only the responsible recruitment-hr account can read or change its positions and related private records. Closing a position stops new candidates, offers and onboarding conversion; existing employee handovers remain manageable. No public vacancy board or HR reassignment is included.',
      '仅负责该职位且仍持 recruitment-hr 角色的账号可读写职位及关联私人资料。关闭职位会停止新增候选人、录用和转入职，既有员工交接仍可处理。首版不含公开招聘网站和 HR 转交。'
    ),
    listing: { resourceId: 'hr-positions', columns: hrPositionColumns, search: true },
    details: [{ field: 'description', label: t('Requirements', '岗位要求'), multiline: true }],
    related: [
      {
        resourceId: 'hr-candidates',
        foreignKey: 'position_id',
        title: t('Private applications', '私人应聘记录'),
        columns: hrCandidateColumns
      }
    ],
    actions: [
      formAction({
        id: 'create-hr-position',
        en: 'Create position',
        zh: '新建职位',
        inputs: positionInputs()
      }),
      formAction({
        id: 'update-hr-position',
        en: 'Edit or close position',
        zh: '编辑或关闭职位',
        inputs: [...positionInputs(true), hrNote()],
        parameters: {
          positionId: selectedParameter(),
          expectedVersion: selectedParameter('version')
        }
      })
    ]
  }
}
