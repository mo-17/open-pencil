import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { businessTemplateDefinition } from '../business/definitions'
import { businessLabel, businessText as t } from '../business/types'
import { gettingStartedModuleBoundaries } from './boundaries'
import { businessPreparationSteps } from './preparation'
import { recognizedBusinessModules } from './recognition'
import { currentBusinessRoles } from './roles'
import type { BackendGettingStartedGuide } from './types'

export type { BackendGettingStartedGuide, BackendGettingStartedModule } from './types'

const accountSetup = t(
  'Sign in first. On the Account setup page, register your own display name when a business form needs an account profile. Registration does not grant a business role; an identity-service administrator assigns roles separately.',
  '先完成登录；业务表单需要账号资料时，在“账号设置”页面登记本人的显示名称。资料登记不会授予业务角色，角色由身份服务管理员另行分配。'
)

const boundaries = [
  t(
    'This guide reads the saved declaration. It does not verify sign-in, assign roles, deploy a server or change permissions. The listed roles are template roles still referenced by the current backend, not roles granted to your account.',
    '本指南只读取已保存声明，不验证登录、不授予角色、不部署服务，也不更改权限。列出的角色是当前后端仍引用的模板角色，不表示当前账号已获授权。'
  ),
  t(
    'Combined modules share the configured sign-in and business account records in one modular backend. Their data and permissions remain separate; CRM contacts, contract counterparties, assets and employees are not automatically linked or synchronized.',
    '组合模块在模块化单体后端中共用登录配置和业务账号资料，各自数据及权限仍然独立；CRM 客户、合同交易对方、资产与员工不会自动关联或同步。'
  ),
  t(
    'Preparation steps describe the template workflow. Check any edited commands and permissions before use. Template default entry paths may have changed; verify the actual canvas routes and export scope before preview or export.',
    '准备顺序说明模板的标准流程；使用前请核对修改过的命令和权限。模板默认入口可能已被修改，预览或导出前请核对画布实际路由及导出范围。'
  )
]

export function createBackendGettingStartedGuide(
  application: BackendApplicationSpecV1,
  locale: string
): BackendGettingStartedGuide | null {
  const parsed = parseBackendApplicationSpecV1(application)
  if (!parsed.ok) return null
  const saved = parsed.value
  const authentication = saved.httpApi?.browserClient?.authentication
  if (!authentication) return null
  const modules = recognizedBusinessModules(saved).flatMap(({ kind, declaration }) => {
    const definition = businessTemplateDefinition(kind)
    const entry = definition.pages.find((page) => page.id === definition.entryPage)
    if (!entry) return []
    return [
      {
        kind,
        name: businessLabel(definition.title, locale),
        defaultEntryPath: entry.path,
        roles: currentBusinessRoles(saved, definition, declaration),
        steps: businessPreparationSteps(kind, locale),
        boundaries: gettingStartedModuleBoundaries(kind, locale)
      }
    ]
  })
  if (!modules.length) return null
  return {
    applicationId: saved.applicationId,
    authentication: {
      issuer: authentication.issuer,
      clientId: authentication.clientId,
      callbackPath: authentication.callbackPath
    },
    modules,
    roles: [...new Set(modules.flatMap((module) => module.roles))],
    accountSetup: businessLabel(accountSetup, locale),
    boundaries: boundaries.map((boundary) => businessLabel(boundary, locale))
  }
}
