import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import {
  contractEvidenceInputs,
  contractSelected,
  contractStatusChoices,
  deliveryColumns,
  quoteColumns,
  quoteDetails
} from './fields'

export function contractsPage(): BusinessPageDefinition {
  const parameters = contractSelected('contractId')
  const when = { field: 'status', values: ['active'] }
  return {
    id: 'contracts',
    path: '/contracts/records',
    title: t('Contract fulfillment', '合同履约'),
    description: t(
      'Record delivery stages, then record external acceptance in stage order. The server bounds cumulative quantities and requires all quoted units to be delivered and accepted before closure. Cancellation preserves records. Payments, refunds and electronic signatures are connected after export; refresh manually for current state.',
      '逐阶段登记交付，再按阶段顺序登记外部验收。服务器限制累计数量，全部报价数量交付并验收后才能结案。取消保留记录。付款、退款及电子签约需导出后接入；请手动刷新当前状态。'
    ),
    listing: {
      resourceId: 'contracts',
      columns: [...quoteColumns, { field: 'status', label: t('Status', '状态') }],
      search: true,
      filter: { field: 'status', choices: contractStatusChoices }
    },
    details: [
      ...quoteDetails,
      { field: 'delivered_quantity', label: t('Delivered quantity', '已交付数量') },
      { field: 'accepted_quantity', label: t('Accepted quantity', '已验收数量') },
      {
        field: 'confirmation_reference',
        label: t('External confirmation reference', '外部确认凭据')
      },
      { field: 'confirmation_note', label: t('Confirmation note', '确认说明'), multiline: true }
    ],
    related: [
      {
        title: t('Delivery stages', '交付阶段'),
        resourceId: 'contract-deliveries',
        foreignKey: 'contract_id',
        columns: deliveryColumns
      },
      {
        title: t('Operation history', '操作历史'),
        resourceId: 'contract-history',
        foreignKey: 'contract_id',
        columns: [
          { field: 'action', label: t('Action', '操作') },
          { field: 'reference', label: t('Evidence reference', '凭据编号') },
          { field: 'note', label: t('Note', '说明'), multiline: true },
          { field: 'created_at', label: t('Recorded at', '记录时间') }
        ]
      }
    ],
    actions: [
      formAction({
        id: 'record-contract-delivery',
        en: 'Record delivery stage',
        zh: '登记交付阶段',
        parameters,
        when,
        inputs: [
          { ...textInput('title', 'Stage title', '阶段标题', 200), required: true },
          {
            key: 'quantity',
            label: t('Delivered units', '本次交付数量'),
            kind: 'number',
            min: 1,
            max: 100000,
            initial: 1
          },
          ...contractEvidenceInputs()
        ],
        description: t(
          'Record work already delivered and its external reference. Stage amounts use the immutable contract unit price. This does not transfer money.',
          '登记已完成的交付及其外部凭据。阶段金额采用不可变合同单价，不发生资金划转。'
        )
      }),
      formAction({
        id: 'accept-contract-delivery',
        en: 'Record external acceptance',
        zh: '登记外部验收',
        parameters,
        when,
        inputs: [
          {
            key: 'deliveryId',
            label: t('Next pending stage', '下一待验收阶段'),
            kind: 'relation',
            relation: {
              resourceId: 'contract-deliveries',
              labelField: 'title',
              columns: deliveryColumns.slice(0, 3),
              filters: {
                contract_id: selectedParameter(),
                sequence: selectedParameter('next_accept_sequence'),
                status: { kind: 'literal', value: 'submitted' }
              }
            }
          },
          ...contractEvidenceInputs()
        ],
        description: t(
          'Select the next pending stage and reference the acceptance already obtained outside this app. This internal record does not impersonate customer acceptance.',
          '选择下一待验收阶段，填写在本应用之外已取得的验收凭据。内部登记不冒充客户验收。'
        )
      }),
      formAction({
        id: 'close-contract',
        en: 'Close fulfilled contract',
        zh: '结案已履行合同',
        parameters,
        when,
        inputs: contractEvidenceInputs(),
        description: t(
          'Close only after every quoted unit and stage has been accepted. Closure does not collect payment.',
          '全部报价数量及所有阶段验收后才可结案，结案不进行收款。'
        )
      }),
      formAction({
        id: 'cancel-contract',
        en: 'Cancel further fulfillment',
        zh: '取消后续履约',
        parameters,
        when,
        inputs: contractEvidenceInputs(true),
        description: t(
          'Explain the cancellation and reference its evidence. Existing delivery and acceptance records remain; this does not refund or reopen a contract.',
          '说明取消原因并填写凭据。已有交付与验收记录保留，不退款，也不能重新打开合同。'
        )
      })
    ]
  }
}

export function contractDeliveriesPage(): BusinessPageDefinition {
  return {
    id: 'contract-deliveries',
    path: '/contracts/deliveries',
    title: t('Delivery records', '交付记录'),
    description: t(
      'Inspect your recorded stages and external evidence. Select the parent contract on Contract fulfillment to register or accept a stage using its current revision. Stage totals are CNY cents; they are not collected payments.',
      '查看本人的交付阶段与外部凭据。登记或验收时，请到合同履约选择所属合同，以当前合同版本操作。阶段金额单位为人民币分，不代表已收款。'
    ),
    listing: {
      resourceId: 'contract-deliveries',
      columns: deliveryColumns,
      search: true,
      filter: {
        field: 'status',
        choices: [
          { value: 'submitted', label: t('Pending acceptance', '待验收') },
          { value: 'accepted', label: t('Acceptance recorded', '已登记验收') }
        ]
      }
    },
    details: [
      { field: 'contract_id', label: t('Contract ID', '合同编号') },
      { field: 'amount_cents', label: t('Stage amount (CNY cents)', '阶段金额（人民币分）') },
      { field: 'reference', label: t('Delivery evidence', '交付凭据') },
      { field: 'note', label: t('Delivery note', '交付说明'), multiline: true },
      { field: 'acceptance_reference', label: t('Acceptance evidence', '验收凭据') },
      { field: 'acceptance_note', label: t('Acceptance note', '验收说明'), multiline: true },
      { field: 'accepted_at', label: t('Acceptance recorded at', '验收登记时间') }
    ],
    actions: []
  }
}
