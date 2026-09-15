import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { businessTemplateDefinition } from '@/app/lowcode/backend/business/definitions'
import { BUSINESS_TEMPLATE_IDS } from '@/app/lowcode/backend/business/model/types'
import { businessLabel } from '@/app/lowcode/backend/business/types'
import { createBackendGettingStartedGuide } from '@/app/lowcode/backend/getting-started'
import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'

import {
  authentication,
  business,
  changeRoleReferences,
  enterprise,
  enterpriseKinds
} from './helpers'

describe('saved backend getting started guide', () => {
  test.each(BUSINESS_TEMPLATE_IDS)(
    'recognizes %s standalone with complete bilingual preparation',
    (kind) => {
      const application = business(kind)
      const before = structuredClone(application)
      const definition = businessTemplateDefinition(kind)
      for (const locale of ['en', 'zh-CN']) {
        const guide = createBackendGettingStartedGuide(application, locale)
        expect(guide?.modules).toHaveLength(1)
        const module = guide?.modules[0]
        expect(module?.kind).toBe(kind)
        expect(module?.name).toBe(businessLabel(definition.title, locale))
        expect(module?.defaultEntryPath).toBe(
          definition.pages.find((page) => page.id === definition.entryPage)?.path
        )
        expect(module?.roles).toEqual(definition.roles)
        expect(module?.steps).toHaveLength(3)
        expect(module?.boundaries.length).toBeGreaterThan(0)
        const localized = [...(module?.steps ?? []), ...(module?.boundaries ?? [])]
        expect(
          localized.every((text) => /[\u3400-\u9fff]/u.test(text) === (locale === 'zh-CN'))
        ).toBe(true)
      }
      const modular = composeBusinessModules(application, [kind], {
        adoptExisting: [kind]
      }).application
      const guide = createBackendGettingStartedGuide(modular, 'en')
      expect(guide?.modules.map((module) => module.kind)).toEqual([kind])
      expect(guide?.roles).toEqual(definition.roles)
      expect(application).toEqual(before)
    }
  )

  test('reads the actual CRM, assets, contracts and recruitment composition without changing it', () => {
    const application = enterprise()
    const before = JSON.stringify(application)
    const guide = createBackendGettingStartedGuide(application, 'zh-CN')
    expect(guide?.modules.map((module) => module.kind)).toEqual(enterpriseKinds)
    expect(guide?.roles).toEqual([
      'crm-manager',
      'asset-manager',
      'contract-manager',
      'recruitment-hr'
    ])
    expect(guide?.authentication).toEqual({
      issuer: authentication.issuer,
      clientId: authentication.clientId,
      callbackPath: authentication.callbackPath
    })
    expect(Object.keys(guide?.authentication ?? {}).sort()).toEqual([
      'callbackPath',
      'clientId',
      'issuer'
    ])
    expect(guide?.boundaries.join(' ')).toContain('不会自动关联或同步')
    expect(guide?.accountSetup).toContain('“账号设置”')
    expect(guide?.accountSetup).toContain('不会授予业务角色')
    expect(JSON.stringify(guide)).not.toContain('JWT_JWKS')
    expect(Object.hasOwn(guide ?? {}, 'secrets')).toBe(false)
    expect(JSON.stringify(application)).toBe(before)
  })

  test('filters defined roles through current command and related-member permissions', () => {
    const application = enterprise()
    application.auth.roles.push({ id: 'custom-hr', name: 'custom_hr' })
    changeRoleReferences(application, 'recruitment-hr', 'custom-hr')
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    const guide = createBackendGettingStartedGuide(application, 'en')
    expect(guide?.modules.map((module) => module.kind)).toEqual(enterpriseKinds)
    expect(guide?.modules.find((module) => module.kind === 'recruitment-hr')?.roles).toEqual([])
    expect(guide?.roles).not.toContain('recruitment-hr')
    expect(guide?.roles).not.toContain('custom-hr')
    expect(guide?.roles).toContain('contract-manager')
  })

  test('retains a role needed only by a currently referenced row-policy or command', () => {
    const application = enterprise()
    for (const command of application.commands?.commands ?? []) {
      if (!('roleId' in command.access) || command.access.roleId !== 'recruitment-hr') continue
      if (command.access.kind === 'role') command.access = { kind: 'authenticated' }
      else delete command.access.roleId
    }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    expect(createBackendGettingStartedGuide(application, 'en')?.roles).toContain('recruitment-hr')
    for (const policy of application.auth.rowAccess)
      if (
        policy.principal.kind === 'related-member' &&
        policy.principal.roleId === 'recruitment-hr'
      )
        delete policy.principal.roleId
    const command = application.commands?.commands.find(
      (entry) => entry.id === 'create-hr-position'
    )
    if (!command) throw new Error('Missing HR fixture command')
    command.access = { kind: 'role', roleId: 'recruitment-hr' }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    expect(createBackendGettingStartedGuide(application, 'en')?.roles).toContain('recruitment-hr')
  })

  test('does not list an old role from an unreferenced policy on a recognized module', () => {
    const application = enterprise()
    application.auth.roles.push({ id: 'custom-hr', name: 'custom_hr' })
    changeRoleReferences(application, 'recruitment-hr', 'custom-hr')
    const referenced = application.auth.rowAccess.find(
      (entry) => entry.principal.kind === 'related-member' && entry.principal.roleId === 'custom-hr'
    )
    if (!referenced) throw new Error('Missing HR related-member policy')
    application.auth.rowAccess.push({
      ...structuredClone(referenced),
      id: 'unused-old-hr-role',
      principal: { kind: 'role', roleId: 'recruitment-hr' }
    })
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    expect(createBackendGettingStartedGuide(application, 'en')?.roles).not.toContain(
      'recruitment-hr'
    )
  })

  test('requires module ownership, ignoring renamed or incomplete declarations', () => {
    const application = composeBusinessModules(business('asset-management'), ['asset-management'], {
      adoptExisting: ['asset-management']
    }).application
    const module = application.modules?.modules.find((entry) => entry.id === 'asset-management')
    if (!module) throw new Error('Missing module fixture')
    module.id = 'quote-contracts'
    module.name = 'Quote contracts'
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    expect(createBackendGettingStartedGuide(application, 'en')).toBeNull()
    module.id = 'unrecognized-custom-business'
    expect(createBackendGettingStartedGuide(application, 'en')).toBeNull()
  })

  test('does not guess an edited unannotated template or an unrelated app', () => {
    const edited = business()
    edited.auth.roles.push({ id: 'custom-manager', name: 'custom_manager' })
    changeRoleReferences(edited, 'crm-manager', 'custom-manager')
    expect(parseBackendApplicationSpecV1(edited).ok).toBe(true)
    expect(createBackendGettingStartedGuide(edited, 'en')).toBeNull()
    expect(
      createBackendGettingStartedGuide(createNestJSNotesApplication('notes-only'), 'zh-CN')
    ).toBeNull()
  })

  test('fails closed on invalid saved declarations and unvalidated public auth fields', () => {
    const application = business()
    application.dataModel.entities = []
    expect(createBackendGettingStartedGuide(application, 'en')).toBeNull()
    const invalidAuth = business()
    const client = invalidAuth.httpApi?.browserClient
    if (!client) throw new Error('Missing browser client')
    Object.assign(client.authentication, { clientSecret: 'must-never-be-carried' })
    expect(createBackendGettingStartedGuide(invalidAuth, 'en')).toBeNull()
  })

  test('keeps default entry paths explicit and translates Chinese locale variants only', () => {
    const application = enterprise()
    const resource = application.httpApi?.resources.find((entry) => entry.id === 'customers')
    if (!resource) throw new Error('Missing customer resource')
    resource.path = '/renamed-api-customers'
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    const english = createBackendGettingStartedGuide(application, 'fr')
    const chinese = createBackendGettingStartedGuide(application, 'ZH-tw')
    expect(english?.modules[0]?.defaultEntryPath).toBe('/customers')
    expect(Object.hasOwn(english?.modules[0] ?? {}, 'entryPath')).toBe(false)
    expect(english?.boundaries.join(' ')).toContain('Template default entry paths may have changed')
    expect(chinese?.boundaries.join(' ')).toContain('模板默认入口可能已被修改')
    expect(english?.modules[0]?.name).not.toEqual(chinese?.modules[0]?.name)
  })
})
