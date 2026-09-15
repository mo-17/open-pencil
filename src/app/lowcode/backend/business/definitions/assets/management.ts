import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import {
  assetColumns,
  assetDetails,
  assetHistoryColumns,
  assetInputs,
  assetNote,
  assetStatusChoices
} from './fields'

export function assetManagementPage(): BusinessPageDefinition {
  const keys = { assetId: selectedParameter(), expectedVersion: selectedParameter('version') }
  return {
    id: 'asset-management',
    path: '/assets/admin',
    title: t('Asset register and maintenance', '资产登记与维护'),
    description: t(
      'Requires asset-manager. Register each physical asset under a permanent unique tag. Only available assets can be edited, sent for repair or retired; first record the return of an asset in use. Complete a repair before retirement. Registration owner, actual custodian and audit actor remain separate. This single-organization register does not synchronize stock with inventory or commerce.',
      '需要 asset-manager。每台实物使用永久唯一标签登记。在库可用资产才能编辑、送修或报废；使用中的资产必须先归还。维修中的资产先登记恢复，再报废。登记账号、实际保管人和审计操作人分别记录。本单组织资产台账不会自动同步进销存或电商库存。'
    ),
    listing: {
      resourceId: 'asset-management',
      columns: assetColumns,
      search: true,
      filter: { field: 'status', choices: assetStatusChoices }
    },
    details: [
      ...assetDetails,
      { field: 'registered_by', label: t('Registered by account', '登记账号') },
      { field: 'custodian_subject', label: t('Current custodian account', '当前保管账号') },
      { field: 'current_request_id', label: t('Current handover request', '当前交付申请') }
    ],
    related: [
      {
        resourceId: 'asset-history',
        foreignKey: 'asset_id',
        title: t('Asset audit trail', '资产审计记录'),
        columns: assetHistoryColumns
      }
    ],
    actions: [
      formAction({
        id: 'create-asset',
        en: 'Register asset',
        zh: '登记资产',
        inputs: [textInput('tag', 'Permanent asset tag', '永久资产标签'), ...assetInputs()]
      }),
      formAction({
        id: 'update-asset',
        en: 'Edit available asset',
        zh: '编辑在库资产',
        inputs: [...assetInputs(true), assetNote()],
        parameters: keys,
        when: { field: 'status', values: ['available'] }
      }),
      ...[
        ['start-asset-repair', 'Start repair', '登记送修', 'available'],
        ['complete-asset-repair', 'Complete repair', '维修完成恢复', 'repair'],
        ['retire-asset', 'Retire asset', '登记报废', 'available']
      ].map(([id, en, zh, status]) =>
        formAction({
          id,
          en,
          zh,
          inputs: [assetNote()],
          parameters: keys,
          when: { field: 'status', values: [status] }
        })
      )
    ]
  }
}
export function assetAuditPage(): BusinessPageDefinition {
  return {
    id: 'asset-history',
    path: '/assets/admin/history',
    title: t('Asset audit history', '资产审计历史'),
    description: t(
      'Only asset managers can read the append-only audit. Each entry records the acting account, asset state and version before/after, request result and explanation. There are no direct edit or delete actions and no automatic external asset-system integration.',
      '只有资产管理员可以查阅只追加的审计记录。每条记录包括操作账号、前后资产状态与版本、申请结果及说明。没有直接编辑或删除入口，也不自动调用外部资产系统。'
    ),
    listing: { resourceId: 'asset-history', columns: assetHistoryColumns },
    details: [
      ...assetHistoryColumns,
      { field: 'asset_id', label: t('Asset reference', '资产编号') },
      { field: 'request_id', label: t('Request reference', '申请编号') },
      { field: 'actor_subject', label: t('Acting account', '操作账号') },
      { field: 'before_version', label: t('Previous asset version', '原资产版本') },
      { field: 'after_version', label: t('Resulting asset version', '新资产版本') }
    ],
    actions: []
  }
}
