import {
  businessText as t,
  type BusinessActionDefinition,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import {
  assetColumns,
  assetDetails,
  assetHistoryColumns,
  assetNote,
  assetRequestColumns,
  assetRequestDetails,
  assetRequestStatusChoices
} from './fields'

export function assetCatalogPage(): BusinessPageDefinition {
  return {
    id: 'assets',
    path: '/assets',
    title: t('Available assets', '可用资产'),
    description: t(
      'Sign in to browse available assets and request an assignment or a time-limited loan for yourself. A request does not reserve the asset. A manager confirms the actual handover; competing requests remain pending until cancelled or rejected. Display names are self-entered, not verified employee identities.',
      '登录后查看可用资产，为本人申请领用或限时借用。提交申请不会预留资产，实际交付由管理员确认；其他待领申请需本人取消或管理员拒绝。显示名称由本人填写，不代表已核验员工身份。'
    ),
    listing: { resourceId: 'assets', columns: assetColumns, search: true },
    details: assetDetails,
    actions: (['assignment', 'loan'] as const).map((kind) =>
      formAction({
        id: 'request-asset-' + kind,
        en: kind === 'loan' ? 'Request a loan' : 'Request assignment',
        zh: kind === 'loan' ? '申请借用' : '申请领用',
        parameters: { assetId: selectedParameter() },
        inputs: [
          textInput('borrowerName', 'My display name', '本人显示名称'),
          textInput('purpose', 'Use purpose', '使用用途', 1000),
          ...(kind === 'loan'
            ? [
                textInput(
                  'dueAt',
                  'Return deadline (zoned ISO 8601)',
                  '归还截止时间（带时区 ISO 8601）',
                  40
                )
              ]
            : [])
        ],
        description:
          kind === 'loan'
            ? t(
                'Use a future explicit time such as 2030-01-01T18:00:00+08:00. The same deadline is checked again at handover. Expired requests must be rejected or cancelled and submitted again; there are no automatic reminders.',
                '使用未来的明确时间，例如 2030-01-01T18:00:00+08:00。实际交付时再次校验原截止时间。过期申请需拒绝或取消后重新提交，不会自动发送催还提醒。'
              )
            : t(
                'Assignments have no fixed due date. They still require a recorded return before repair or retirement.',
                '领用不设固定归还期限，但进入维修或报废前仍必须登记归还。'
              ),
        when: { field: 'status', values: ['available'] }
      })
    )
  }
}
const requestKeys = () => ({
  assetId: selectedParameter('asset_id'),
  requestId: selectedParameter(),
  expectedVersion: selectedParameter('version')
})
export function assetRequestsPage(manager = false): BusinessPageDefinition {
  const actions: BusinessActionDefinition[] = manager
    ? [
        ...(['assignment', 'loan'] as const).map((kind) =>
          formAction({
            id: 'issue-asset-' + kind,
            en: kind === 'loan' ? 'Confirm loan handover' : 'Confirm assignment handover',
            zh: kind === 'loan' ? '确认借用交付' : '确认领用交付',
            inputs: [assetNote()],
            parameters: {
              ...requestKeys(),
              ...(kind === 'loan' ? { dueAt: selectedParameter('due_at') } : {})
            },
            when: {
              all: [
                { field: 'status', values: ['requested'] },
                { field: 'kind', values: [kind] }
              ]
            },
            description: t(
              'Only a pending request can be fulfilled. Confirm physical delivery first. The server locks the request and asset, checks availability and sets custody to the original applicant. A loan deadline must still be in the future.',
              '只有待交付申请可以履约，请先核对实物交接。服务器锁定申请和资产，校验在库状态，并把保管人设为原申请账号；借用截止时间还必须在未来。'
            )
          })
        ),
        formAction({
          id: 'return-asset-request',
          en: 'Confirm physical return',
          zh: '确认实物归还',
          inputs: [assetNote()],
          parameters: requestKeys(),
          when: { field: 'status', values: ['issued'] }
        }),
        formAction({
          id: 'reject-asset-request',
          en: 'Reject pending request',
          zh: '拒绝待领申请',
          inputs: [assetNote()],
          parameters: requestKeys(),
          when: { field: 'status', values: ['requested'] }
        })
      ]
    : [
        formAction({
          id: 'cancel-asset-request',
          en: 'Cancel my pending request',
          zh: '取消本人待领申请',
          inputs: [assetNote()],
          parameters: requestKeys(),
          when: { field: 'status', values: ['requested'] }
        })
      ]
  return {
    id: manager ? 'asset-management-requests' : 'asset-requests',
    path: manager ? '/assets/admin/requests' : '/assets/my-requests',
    title: manager
      ? t('Asset handover desk', '资产交付与归还')
      : t('My asset requests', '我的资产申请'),
    description: manager
      ? t(
          'Requires asset-manager. Filter pending requests before confirming handover, then select issued requests when a physical asset is returned. Asset tags and requester identity come from the server. Refresh after a stale-version conflict; borrowing and assignment do not transfer legal ownership.',
          '需要 asset-manager。筛选待交付申请办理实物交付，实物收回后选择已交付记录办理归还。资产标签与申请账号由服务器确定。版本冲突后请刷新；借用和领用都不表示法律所有权转让。'
        )
      : t(
          'Only your own requests are listed. Cancel pending requests yourself; an asset manager records actual handover or return. A returned, rejected or cancelled request stays as history. Start a new request for the next use cycle.',
          '这里只显示本人的申请。待领申请可自行取消，实际交付和归还由资产管理员登记。已归还、拒绝或取消的申请保留为历史，下次使用请新建申请。'
        ),
    listing: {
      resourceId: manager ? 'asset-management-requests' : 'asset-requests',
      columns: assetRequestColumns,
      search: true,
      filter: { field: 'status', choices: assetRequestStatusChoices }
    },
    details: assetRequestDetails,
    ...(manager
      ? {
          related: [
            {
              resourceId: 'asset-history',
              foreignKey: 'request_id',
              title: t('Request handling history', '申请处理历史'),
              columns: assetHistoryColumns
            }
          ]
        }
      : {}),
    actions
  }
}
