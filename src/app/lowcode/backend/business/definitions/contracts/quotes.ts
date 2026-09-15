import {
  businessText as t,
  type BusinessInput,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import {
  contractEvidenceInputs,
  contractPrefill,
  contractSelected,
  quoteColumns,
  quoteDetails
} from './fields'

function quoteInputs(edit = false): BusinessInput[] {
  return contractPrefill(
    [
      {
        key: 'partyId',
        label: t('Counterparty', '对方'),
        kind: 'relation',
        relation: {
          resourceId: 'contract-parties',
          labelField: 'title',
          filters: { active: { kind: 'literal', value: true } }
        }
      },
      { ...textInput('title', 'Quotation title', '报价标题', 200), required: true },
      {
        ...textInput('itemTitle', 'Single item or service', '单项商品或服务', 200),
        required: true
      },
      { ...textInput('description', 'Scope and terms', '范围与条款', 2000), required: false },
      {
        key: 'quantity',
        label: t('Quantity', '数量'),
        kind: 'number',
        min: 1,
        max: 100000,
        initial: 1
      },
      {
        key: 'unitPriceCents',
        label: t('Unit price (CNY cents)', '单价（人民币分）'),
        kind: 'number',
        min: 0,
        max: 1000000,
        initial: 0
      }
    ],
    edit
  )
}

export function quoteDraftsPage(): BusinessPageDefinition {
  return {
    id: 'quote-drafts',
    path: '/contracts/quotes',
    title: t('Quotation drafts', '报价草稿'),
    description: t(
      'Write one line per quote. Quantity and unit price are integers; the server calculates the CNY-cent total, capped at 1,000,000,000 cents. Publish an immutable version, then record external confirmation on Quotation versions. Edits require publishing a new version.',
      '每份报价包含一项商品或服务。数量与单价填写整数，服务器计算人民币分总额，上限为 1,000,000,000 分。发布不可变版本后，到报价版本登记外部确认。编辑后须重新发布版本。'
    ),
    listing: {
      resourceId: 'quote-drafts',
      columns: [...quoteColumns, { field: 'status', label: t('Status', '状态') }],
      search: true,
      filter: {
        field: 'status',
        choices: [
          { value: 'draft', label: t('Editable', '可编辑') },
          { value: 'contracted', label: t('Contract recorded', '已登记合同') }
        ]
      }
    },
    details: quoteDetails,
    related: [
      {
        title: t('Immutable published versions', '已发布的不可变版本'),
        resourceId: 'quote-versions',
        foreignKey: 'draft_id',
        columns: [{ field: 'revision', label: t('Revision', '修订号') }, ...quoteColumns]
      }
    ],
    actions: [
      formAction({
        id: 'create-quote-draft',
        en: 'Create quote draft',
        zh: '创建报价草稿',
        inputs: quoteInputs()
      }),
      formAction({
        id: 'update-quote-draft',
        en: 'Edit quote draft',
        zh: '编辑报价草稿',
        inputs: quoteInputs(true),
        parameters: contractSelected('draftId'),
        when: { field: 'status', values: ['draft'] }
      }),
      formAction({
        id: 'publish-quote-version',
        en: 'Freeze quotation version',
        zh: '冻结报价版本',
        inputs: [],
        parameters: contractSelected('draftId'),
        when: { field: 'status', values: ['draft'] },
        description: t(
          'Save a new immutable snapshot. This does not send a quotation or record customer acceptance.',
          '保存一份新的不可变快照。此操作不发送报价，也不代表客户已接受。'
        )
      })
    ]
  }
}

export function quoteVersionsPage(): BusinessPageDefinition {
  return {
    id: 'quote-versions',
    path: '/contracts/versions',
    title: t('Quotation versions', '报价版本'),
    description: t(
      'Select the latest unchanged quotation and record evidence of confirmation obtained outside this app. This internal entry creates a contract snapshot; it is not a customer electronic signature. A draft can form only one contract. Older versions remain readable but cannot be confirmed.',
      '选择最新且草稿未再变更的报价，登记在本应用之外取得的确认凭据。内部登记生成合同快照，不是客户电子签名。一份草稿只能形成一份合同。旧版保留可读，但不能确认。'
    ),
    listing: {
      resourceId: 'quote-versions',
      search: true,
      columns: [{ field: 'revision', label: t('Revision', '修订号') }, ...quoteColumns]
    },
    details: quoteDetails,
    actions: [
      formAction({
        id: 'confirm-quote-contract',
        en: 'Record external confirmation',
        zh: '登记外部确认',
        inputs: contractEvidenceInputs(),
        parameters: {
          draftId: selectedParameter('draft_id'),
          quoteVersionId: selectedParameter(),
          expectedVersion: selectedParameter('draft_version')
        },
        description: t(
          'Enter the reference to the confirmation you already obtained. The server checks the frozen revision and blocks duplicate contracts. Electronic signing and collection are connected after export.',
          '填写已取得的确认凭据编号。服务器核验冻结版本并阻止重复合同。电子签约与真实收款需导出后接入。'
        )
      })
    ]
  }
}
