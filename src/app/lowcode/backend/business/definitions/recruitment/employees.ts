import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import {
  hrChecklistColumns,
  hrEmployeeColumns,
  hrHistoryColumns,
  hrNote,
  hrSelectedEmployee
} from './fields'

export function hrEmployeesPage(): BusinessPageDefinition {
  return {
    id: 'hr-employees',
    path: '/hr/employees',
    title: t('Onboarding and offboarding', '员工入职与离职'),
    description: t(
      'Each phase needs 1–100 required checklist items and every item must be completed before the HR status changes. Starting offboarding resets only current-phase counters; onboarding records remain. HR decides which tasks are required. Completing a task only records manual confirmation: it does not create or revoke accounts, transfer equipment, notify anyone or run payroll.',
      '每个阶段需要 1 至 100 条必做清单，全部完成后才能变更 HR 状态。发起离职只重置当前阶段计数，入职清单保留。必做事项由 HR 明确制定；勾选仅记录人工确认，不会创建或回收账号、转移资产、发送通知或执行薪资操作。'
    ),
    listing: { resourceId: 'hr-employees', columns: hrEmployeeColumns, search: true },
    details: [{ field: 'contact', label: t('Contact snapshot', '联系方式快照') }],
    related: [
      {
        resourceId: 'hr-checklist',
        foreignKey: 'employee_id',
        title: t('Checklist · all phases', '全部阶段清单'),
        columns: hrChecklistColumns
      },
      {
        resourceId: 'hr-history',
        foreignKey: 'target_id',
        title: t('Employee audit records', '员工操作记录'),
        columns: hrHistoryColumns
      }
    ],
    actions: [
      formAction({
        id: 'add-hr-checklist-item',
        en: 'Add required checklist item',
        zh: '新增必做清单项',
        inputs: [
          textInput('title', 'Required task', '必做事项', 200),
          {
            ...textInput('description', 'Completion requirements', '完成要求', 1000),
            required: false
          },
          hrNote()
        ],
        parameters: hrSelectedEmployee(),
        when: { field: 'status', values: ['onboarding', 'offboarding'] }
      }),
      ...(
        [
          ['complete-hr-onboarding', 'Complete onboarding', '确认入职完成', 'onboarding'],
          ['start-hr-offboarding', 'Start offboarding', '发起离职交接', 'active'],
          ['complete-hr-offboarding', 'Confirm departure', '确认离职完成', 'offboarding']
        ] as const
      ).map(([id, en, zh, status]) =>
        formAction({
          id,
          en,
          zh,
          inputs: [hrNote()],
          parameters: hrSelectedEmployee(),
          when: { field: 'status', values: [status] }
        })
      )
    ]
  }
}

export function hrChecklistPage(): BusinessPageDefinition {
  return {
    id: 'hr-checklist',
    path: '/hr/checklist',
    title: t('Manual checklist completion', '清单人工确认'),
    description: t(
      'Select a task, check its linked employee and phase, then record completion once. Only the current onboarding or offboarding phase accepts confirmations. Old-phase tasks cannot complete a later phase. Items cannot be deleted or rewritten; verify the requirements before adding them.',
      '选择事项，核对关联员工及所属阶段，再确认完成一次。仅当前入职或离职阶段可确认，旧阶段事项不能用于完成新阶段。清单项不可删除或改写，请在添加前核对要求。'
    ),
    listing: {
      resourceId: 'hr-checklist',
      columns: hrChecklistColumns,
      search: true,
      filter: {
        field: 'completed',
        choices: [
          { value: false, label: t('Pending', '待完成') },
          { value: true, label: t('Completed', '已完成') }
        ]
      }
    },
    details: [
      { field: 'description', label: t('Completion requirements', '完成要求'), multiline: true },
      { field: 'completed_by', label: t('Confirmed by', '确认人') },
      { field: 'completed_at', label: t('Confirmed at', '确认时间') }
    ],
    related: [
      {
        resourceId: 'hr-employees',
        foreignKey: 'id',
        selectionField: 'employee_id',
        title: t('Employee and current stage', '关联员工与当前阶段'),
        columns: hrEmployeeColumns
      }
    ],
    actions: [
      formAction({
        id: 'complete-hr-checklist-item',
        en: 'Confirm manual completion',
        zh: '确认已人工完成',
        inputs: [hrNote()],
        parameters: {
          positionId: selectedParameter('position_id'),
          employeeId: selectedParameter('employee_id'),
          itemId: selectedParameter(),
          expectedVersion: selectedParameter('version')
        },
        when: { field: 'completed', values: [false] }
      })
    ]
  }
}
