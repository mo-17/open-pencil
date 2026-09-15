import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import {
  composeBusinessModules,
  detectStandaloneBusinessKinds,
  previewComposeBusinessModules
} from '@/app/lowcode/backend/business/composition'
import { BUSINESS_TEMPLATE_IDS } from '@/app/lowcode/backend/business/model/types'
import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'

import { authentication, BOUNDED_BUSINESS_GROUPS, business, resource } from './helpers'

describe('pure business module composition', () => {
  test.each(BUSINESS_TEMPLATE_IDS)(
    'adopts the unchanged %s standalone without changing any authority or record',
    (kind) => {
      const base = business(kind)
      const before = structuredClone(base)
      expect(detectStandaloneBusinessKinds(base)).toEqual([kind])
      const result = composeBusinessModules(base, [kind], { adoptExisting: [kind] })
      expect(result.addedKinds).toEqual([])
      expect(result.adoptedKinds).toEqual([kind])
      expect(result.addedEntities).toEqual([])
      expect(result.bindings[kind]).toEqual({ users: 'users' })
      expect(result.sharedAccountWasPresent).toBe(true)
      const { modules, ...unchanged } = result.application
      expect(unchanged).toEqual(before)
      expect(base).toEqual(before)
      expect(modules?.modules.map((entry) => entry.id)).toEqual(['shared-accounts', kind])
      expect(parseBackendApplicationSpecV1(result.application).ok).toBe(true)
    }
  )

  test.each(BOUNDED_BUSINESS_GROUPS)(
    'composes $name while preserving CRM directory and sensitive record permissions',
    ({ kinds, entities, commands }) => {
      const base = business()
      const before = structuredClone(base)
      const result = composeBusinessModules(base, kinds, {
        adoptExisting: ['customer-crm']
      })
      expect(base).toEqual(before)
      expect(result.application.applicationId).toBe(before.applicationId)
      expect(result.application.auth.identities).toEqual(before.auth.identities)
      expect(result.application.httpApi?.authentication).toEqual(before.httpApi?.authentication)
      expect(result.application.httpApi?.browserClient).toEqual(before.httpApi?.browserClient)
      expect(result.application.secrets).toEqual(before.secrets)
      expect(result.installedKinds).toEqual([...kinds])
      expect(result.addedKinds).toEqual(kinds.slice(1))
      expect(result.application.dataModel.entities).toHaveLength(entities)
      expect(result.application.commands?.commands).toHaveLength(commands)
      expect(result.application.modules?.modules).toHaveLength(kinds.length + 1)
      expect(resource(result.application, 'users')).toEqual(resource(before, 'users'))
      for (const entry of before.auth.rowAccess)
        expect(result.application.auth.rowAccess.find((policy) => policy.id === entry.id)).toEqual(
          entry
        )
      for (const kind of kinds.slice(1)) {
        const id = kind + '-users'
        expect(result.bindings[kind]).toEqual({ users: id })
        const directory = resource(result.application, id)
        expect(directory.path).toBe('/' + id)
        expect(directory.entityId).toBe('business-users')
        expect(directory.readPolicyIds).not.toContain('crm-manager-directory')
      }
      expect(resource(result.application, 'my-profile').readPolicyIds).toEqual(['own-users'])
      expect(
        result.application.dataModel.entities.filter((entry) => entry.name === 'users')
      ).toHaveLength(1)
      expect(
        result.application.commands?.commands.filter(
          (entry) => entry.id === 'register-business-user'
        )
      ).toHaveLength(1)
      expect(parseBackendApplicationSpecV1(result.application).diagnostics).toEqual([])
      const repeated = composeBusinessModules(result.application, [...kinds].reverse())
      expect(repeated.application).toEqual(result.application)
      expect(repeated.addedKinds).toEqual([])
      expect(repeated.bindings).toEqual(result.bindings)
    }
  )

  test('covers every available template in bounded groups and rejects the oversized all-in-one model atomically', () => {
    expect(
      [...new Set(BOUNDED_BUSINESS_GROUPS.flatMap((group) => [...group.kinds]))].sort()
    ).toEqual([...BUSINESS_TEMPLATE_IDS].sort())
    const base = business()
    const before = structuredClone(base)
    const result = previewComposeBusinessModules(base, BUSINESS_TEMPLATE_IDS, {
      adoptExisting: ['customer-crm']
    })
    expect(base).toEqual(before)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Oversized composition unexpectedly passed')
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics.every((entry) => entry.code === 'backend-limit-nodes')).toBe(true)
    expect(Object.hasOwn(result, 'application')).toBe(false)
  })

  test.each(['single-merchant', 'multi-merchant'] as const)(
    'adds CRM, support and knowledge to %s commerce without broadening commerce authority',
    (mode) => {
      const base = createCommerceOperationsApplication(
        'existing-commerce',
        authentication,
        mode,
        325
      )
      const before = structuredClone(base)
      const result = composeBusinessModules(base, [
        'customer-crm',
        'service-desk',
        'content-knowledge-base'
      ])
      expect(base).toEqual(before)
      expect(result.sharedAccountWasPresent).toBe(false)
      expect(result.application.commerce).toEqual(before.commerce)
      expect(result.application.secrets).toEqual(before.secrets)
      for (const key of ['identities', 'tenants'] as const)
        expect(result.application.auth[key]).toEqual(before.auth[key])
      for (const entry of before.auth.rowAccess)
        expect(result.application.auth.rowAccess.find((policy) => policy.id === entry.id)).toEqual(
          entry
        )
      for (const entry of before.httpApi?.resources ?? [])
        expect(resource(result.application, entry.id)).toEqual(entry)
      for (const entry of before.commands?.commands ?? [])
        expect(
          result.application.commands?.commands.find((command) => command.id === entry.id)
        ).toEqual(entry)
      const commerce = result.application.modules?.modules.find(
        (entry) => entry.id === 'existing-application'
      )
      expect(commerce?.entityIds).toEqual(before.dataModel.entities.map((entry) => entry.id))
      expect(commerce?.commandIds).toEqual(before.commands?.commands.map((entry) => entry.id))
      expect(commerce?.dependsOn).toEqual([])
      expect(parseBackendApplicationSpecV1(result.application).diagnostics).toEqual([])
    }
  )

  test('keeps an existing alternate JWT binding and public OIDC client instead of importing template defaults', () => {
    const base = business()
    const api = base.httpApi
    if (!api) throw new Error('Missing fixture API')
    api.authentication.identityId = 'existing-user'
    api.authentication.issuerEnvironment = 'EXISTING_ISSUER'
    base.auth.identities = [{ id: 'existing-user', kind: 'user' }]
    base.secrets.push({
      kind: 'environment',
      name: 'EXISTING_ISSUER',
      exposure: 'server',
      required: true
    })
    const result = composeBusinessModules(base, ['service-desk'], {
      adoptExisting: ['customer-crm']
    })
    expect(result.application.httpApi?.authentication).toEqual(api.authentication)
    expect(result.application.auth.identities).toEqual(base.auth.identities)
    expect(result.application.secrets).toEqual(base.secrets)
  })
  test('keeps six selected businesses plus commerce within command and dependency budgets', () => {
    const base = createCommerceOperationsApplication(
      'all-domains',
      authentication,
      'multi-merchant'
    )
    const result = composeBusinessModules(base, [
      'customer-crm',
      'service-desk',
      'content-knowledge-base',
      'booking-registration',
      'project-tasks',
      'rental-viewing'
    ])
    expect(result.application.dataModel.entities).toHaveLength(30)
    expect(result.application.commands?.commands).toHaveLength(69)
    expect(result.application.modules?.modules).toHaveLength(8)
    expect(result.application.httpApi?.resources.length).toBeLessThanOrEqual(64)
    for (const module of result.application.modules?.modules ?? []) {
      expect(module.commandIds.length).toBeLessThanOrEqual(16)
      if (BUSINESS_TEMPLATE_IDS.some((kind) => kind === module.id))
        expect(module.dependsOn).toEqual(['shared-accounts'])
    }
    expect(parseBackendApplicationSpecV1(result.application).diagnostics).toEqual([])
  })

  test('rejects every business plus full commerce at the total node budget without partial changes', () => {
    const base = createCommerceOperationsApplication(
      'all-domains',
      authentication,
      'multi-merchant'
    )
    const before = structuredClone(base)
    const result = previewComposeBusinessModules(base, BUSINESS_TEMPLATE_IDS)
    expect(base).toEqual(before)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Oversized composition unexpectedly passed')
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics.every((entry) => entry.code === 'backend-limit-nodes')).toBe(true)
    expect(result.diagnostics.some((entry) => entry.path.startsWith('$.commands.'))).toBe(true)
    expect(Object.hasOwn(result, 'application')).toBe(false)
  })
})
