import { businessText as t, type BusinessTemplateDefinition } from '../types'
import { accountSetupPage, inputParameter, profileInput, recordAction, textInput } from './shared'

const stages = [
  { value: 'new', label: t('New', '新客户') },
  { value: 'contacted', label: t('Contacted', '已联系') },
  { value: 'qualified', label: t('Qualified', '意向确认') },
  { value: 'proposal', label: t('Proposal', '已报价') },
  { value: 'won', label: t('Won', '已成交') },
  { value: 'lost', label: t('Lost', '已流失') }
]

export function customerCRMDefinition(): BusinessTemplateDefinition {
  const customerInputs = [
    profileInput('my-profile'),
    textInput('title', 'Customer name', '客户名称'),
    textInput('company', 'Company', '公司'),
    textInput('email', 'Email', '邮箱'),
    textInput('phone', 'Phone', '电话'),
    textInput('description', 'Customer notes', '客户备注', 500)
  ]
  const open = { field: 'stage', values: ['new', 'contacted', 'qualified', 'proposal'] }
  return {
    id: 'customer-crm',
    title: t('Customer CRM', '客户与跟进'),
    description: t(
      'Assigned customers, follow-up history and reviewed sales stages.',
      '客户分配、跟进记录与销售阶段流转。'
    ),
    entryPage: 'customers',
    roles: ['crm-manager'],
    pages: [
      accountSetupPage(['crm-manager']),
      {
        id: 'customers',
        path: '/customers',
        title: t('Customers', '客户工作台'),
        description: t(
          'Register your profile in Account setup first. You can read assigned customers; crm-manager can view and assign all customers. Search matches customer name or company on the server.',
          '先在账号设置登记资料。普通账号查看分配给自己的客户，crm-manager 可查看和分配全部客户。搜索由服务器匹配客户名称或公司。'
        ),
        listing: {
          resourceId: 'customers',
          search: true,
          filter: { field: 'stage', choices: stages },
          columns: [
            { field: 'title', label: t('Customer', '客户') },
            { field: 'company', label: t('Company', '公司') },
            { field: 'stage', label: t('Stage', '阶段') },
            { field: 'email', label: t('Email', '邮箱') },
            { field: 'phone', label: t('Phone', '电话') }
          ]
        },
        related: [
          {
            resourceId: 'follow-ups',
            foreignKey: 'customer_id',
            title: t('Follow-up history', '跟进记录'),
            columns: [
              { field: 'action', label: t('Action', '操作') },
              { field: 'note', label: t('Note', '说明') },
              { field: 'after_stage', label: t('Resulting stage', '变更后阶段') },
              { field: 'created_at', label: t('Recorded at', '记录时间') }
            ]
          }
        ],
        actions: [
          {
            id: 'create-customer',
            commandId: 'create-customer',
            label: t('New customer', '新增客户'),
            description: t(
              'Choose your own registered profile. The new customer is assigned to you.',
              '选择本人已登记资料，新客户会分配给你。'
            ),
            inputs: customerInputs,
            parameters: Object.fromEntries(
              customerInputs.map((input) => [input.key, inputParameter(input.key)])
            )
          },
          recordAction({
            id: 'edit',
            en: 'Edit customer',
            zh: '编辑客户',
            commandId: 'edit-customer',
            parameter: 'customerId',
            inputs: [
              ...customerInputs
                .filter((input) => input.key !== 'userId')
                .map((input) => ({ ...input, fromSelection: input.key })),
              textInput('note', 'Change reason', '修改说明', 500)
            ],
            when: open
          }),
          recordAction({
            id: 'assign',
            en: 'Assign customer',
            zh: '分配客户',
            commandId: 'assign-customer',
            parameter: 'customerId',
            inputs: [profileInput(), textInput('note', 'Assignment reason', '分配说明', 500)],
            when: open
          }),
          recordAction({
            id: 'follow-up',
            en: 'Add follow-up',
            zh: '添加跟进',
            commandId: 'add-customer-follow-up',
            parameter: 'customerId',
            when: open
          }),
          ...['contacted', 'qualified', 'proposal', 'won'].map((value, index) =>
            recordAction({
              id: value,
              en: 'Mark ' + stages[index + 1].label.en,
              zh: '标记' + stages[index + 1].label.zh,
              commandId: 'customer-' + value,
              parameter: 'customerId',
              when: { field: 'stage', values: [stages[index].value] }
            })
          ),
          recordAction({
            id: 'lost',
            en: 'Mark Lost',
            zh: '标记已流失',
            commandId: 'customer-lost',
            parameter: 'customerId',
            when: open
          })
        ]
      }
    ]
  }
}
