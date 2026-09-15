import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, textInput } from '../shared'
import { contractActiveInput, contractPrefill, contractSelected } from './fields'

export function contractPartiesPage(): BusinessPageDefinition {
  const inputs = () => [
    { ...textInput('title', 'Counterparty name', '对方名称', 200), required: true },
    { ...textInput('contact', 'Contact information', '联系方式', 200), required: false },
    { ...textInput('description', 'Internal description', '内部说明', 1000), required: false },
    contractActiveInput()
  ]
  return {
    id: 'contract-parties',
    path: '/contracts/parties',
    title: t('Counterparties', '对方资料'),
    description: t(
      'Maintain your private counterparty records with the contract-manager role. This directory works independently; adding CRM does not synchronize it. Changes do not rewrite frozen quotations or contracts.',
      '由 contract-manager 维护本人的对方资料。目录可独立使用，组合 CRM 不会自动同步。修改资料不会改写已冻结的报价或合同快照。'
    ),
    listing: {
      resourceId: 'contract-parties',
      search: true,
      columns: [
        { field: 'title', label: t('Name', '名称') },
        { field: 'contact', label: t('Contact', '联系方式') },
        { field: 'active', label: t('Active', '有效') }
      ]
    },
    details: [
      { field: 'description', label: t('Internal description', '内部说明'), multiline: true }
    ],
    actions: [
      formAction({
        id: 'create-contract-party',
        en: 'Add counterparty',
        zh: '添加对方资料',
        inputs: inputs()
      }),
      formAction({
        id: 'update-contract-party',
        en: 'Edit counterparty',
        zh: '编辑对方资料',
        inputs: contractPrefill(inputs(), true),
        parameters: contractSelected('partyId')
      })
    ]
  }
}
