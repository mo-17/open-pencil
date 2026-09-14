import { businessTemplateDefinition } from '../business/definitions'
import type { BusinessTemplateId } from '../business/model/types'
import { businessLabel } from '../business/types'

export function businessTemplateCopy(kind: BusinessTemplateId, locale: string) {
  const definition = businessTemplateDefinition(kind)
  const chinese = locale.toLowerCase().startsWith('zh')
  const label = (value: Parameters<typeof businessLabel>[0]) => businessLabel(value, locale)
  return {
    name: label(definition.title),
    description: label(definition.description),
    mode: chinese ? '可编辑业务后台' : 'Editable business application',
    tags: [
      label(definition.title),
      'NestJS',
      'OIDC',
      chinese ? '表单与流程' : 'Forms and workflows'
    ],
    roles: [...definition.roles],
    pages: [
      chinese ? '业务系统登录' : 'Business sign in',
      ...definition.pages.map((page) => label(page.title))
    ],
    features: chinese
      ? [
          '可分页列表、服务器搜索、详情及关联记录选择',
          '真实表单、服务端权限及状态校验、操作历史',
          '已保存请求检查、重试与结果核对',
          '可导出 React 或 Vue 页面及 NestJS 后端'
        ]
      : [
          'Paged lists, server search, details and related-record pickers',
          'Working forms, server permissions and transition checks, operation history',
          'Saved request inspection, retry and result acknowledgement',
          'Editable React or Vue pages with a NestJS backend'
        ],
    requirements: chinese
      ? [
          '启用 NestJS Provider，并配置 PostgreSQL 和 OIDC。',
          '创建新应用，或作为模块添加到兼容的应用；登录及账号设置会共享，所需角色仍由身份服务授予。',
          '此模板不会授予角色、启动服务、应用迁移或替换已有应用。',
          '附件、邮件短信、支付和第三方服务在导出后另行接入。'
        ]
      : [
          'Enable the NestJS provider and configure PostgreSQL and OIDC.',
          'Create a new application or add this module to a compatible application. Sign-in and account setup are shared; grant required roles through your identity service.',
          'Creation does not grant roles, start services, apply migrations or replace an existing application.',
          'Connect attachments, email/SMS, payments and third-party services after export.'
        ]
  }
}

export function businessTemplateCopies(locale: string) {
  return {
    'customer-crm': businessTemplateCopy('customer-crm', locale),
    'service-desk': businessTemplateCopy('service-desk', locale),
    'content-knowledge-base': businessTemplateCopy('content-knowledge-base', locale),
    'booking-registration': businessTemplateCopy('booking-registration', locale),
    'project-tasks': businessTemplateCopy('project-tasks', locale)
  }
}
