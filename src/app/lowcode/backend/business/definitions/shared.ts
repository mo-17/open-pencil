import {
  businessText as t,
  type BusinessActionDefinition,
  type BusinessInput,
  type BusinessPageDefinition,
  type BusinessParameterSource
} from '../types'

export const inputParameter = (key: string): BusinessParameterSource => ({ kind: 'input', key })
export const selectedParameter = (field = 'id'): BusinessParameterSource => ({
  kind: 'selection',
  field
})

export function formAction(options: {
  id: string
  en: string
  zh: string
  inputs: readonly BusinessInput[]
  parameters?: BusinessActionDefinition['parameters']
  description?: BusinessActionDefinition['description']
  when?: BusinessActionDefinition['when']
}): BusinessActionDefinition {
  return {
    id: options.id,
    commandId: options.id,
    label: t(options.en, options.zh),
    description:
      options.description ??
      t(
        'Review this request. The server checks permissions and the current record.',
        '请核对本次请求，服务器会检查权限和当前记录。'
      ),
    inputs: options.inputs,
    parameters: {
      ...options.parameters,
      ...Object.fromEntries(options.inputs.map((input) => [input.key, inputParameter(input.key)]))
    },
    ...(options.when ? { when: options.when } : {})
  }
}

export function textInput(key: string, en: string, zh: string, maxLength = 100): BusinessInput {
  return { key, label: t(en, zh), kind: maxLength > 200 ? 'textarea' : 'text', maxLength }
}

export function profileInput(resourceId = 'users', key = 'userId'): BusinessInput {
  return {
    key,
    label: t('Registered account', '已登记账号'),
    kind: 'relation',
    relation: { resourceId, labelField: 'title' }
  }
}

export function accountSetupPage(roles: readonly string[]): BusinessPageDefinition {
  return {
    id: 'account',
    path: '/account-setup',
    title: t('Account setup', '账号设置'),
    description: t(
      `Register your own profile once before selecting it in business forms. An administrator grants ${roles.join(', ')} in the identity service; registration does not grant a role.`,
      `首次使用请登记本人资料，再在业务表单中选择。${roles.join('、')} 需管理员在身份服务中授予，登记资料不会获得角色。`
    ),
    listing: {
      resourceId: 'my-profile',
      columns: [
        { field: 'title', label: t('Name', '名称') },
        { field: 'active', label: t('Active', '有效') }
      ]
    },
    actions: [
      {
        id: 'register-profile',
        label: t('Register my profile', '登记本人资料'),
        description: t(
          'Enter your display name. Each verified account has one profile.',
          '填写显示名称，每个已验证账号只登记一份资料。'
        ),
        commandId: 'register-business-user',
        inputs: [textInput('title', 'Display name', '显示名称')],
        parameters: { title: inputParameter('title') }
      }
    ]
  }
}

export function recordAction(options: {
  id: string
  en: string
  zh: string
  commandId: string
  parameter: string
  inputs?: readonly BusinessInput[]
  when?: BusinessActionDefinition['when']
}): BusinessActionDefinition {
  const inputs = options.inputs ?? [textInput('note', 'Explanation', '操作说明', 500)]
  return {
    id: options.id,
    label: t(options.en, options.zh),
    commandId: options.commandId,
    description: t(
      'Select the current record, review its details and submit this server-checked request.',
      '请先选择当前记录并核对详情，提交后由服务器校验权限及状态。'
    ),
    inputs,
    parameters: {
      [options.parameter]: selectedParameter(),
      ...Object.fromEntries(inputs.map((input) => [input.key, inputParameter(input.key)]))
    },
    ...(options.when ? { when: options.when } : {})
  }
}
