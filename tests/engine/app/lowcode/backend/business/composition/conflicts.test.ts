import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import {
  composeBusinessModules,
  detectStandaloneBusinessKinds,
  previewComposeBusinessModules
} from '@/app/lowcode/backend/business/composition'

import { business, notes, resource } from './helpers'

describe('business composition refusal boundaries', () => {
  test('requires explicit adoption; matching table names do not establish shared account authority', () => {
    const base = business()
    const before = structuredClone(base)
    expect(() => composeBusinessModules(base, ['service-desk'])).toThrow('already in use')
    expect(base).toEqual(before)
  })

  test.each(['entity', 'profile', 'directory', 'command', 'role', 'policy'] as const)(
    'rejects changed standalone %s instead of treating it as an installed module',
    (kind) => {
      const base = business()
      const users = base.dataModel.entities.find((entry) => entry.id === 'business-users')
      const command = base.commands?.commands.find((entry) => entry.id === 'register-business-user')
      const policy = base.auth.rowAccess.find((entry) => entry.id === 'own-users')
      const role = base.auth.roles[0]
      if (!users || !command || !policy || !role) throw new Error('Missing fixture definition')
      if (kind === 'entity') users.name = 'custom_users'
      if (kind === 'profile') resource(base, 'my-profile').readFields.push('owner_id')
      if (kind === 'directory') resource(base, 'users').query.searchFields = []
      if (kind === 'command') command.name = 'Custom registration'
      if (kind === 'role') role.name = 'custom_manager'
      if (kind === 'policy') policy.principal = { kind: 'authenticated' }
      const before = structuredClone(base)
      expect(detectStandaloneBusinessKinds(base)).toEqual([])
      const result = previewComposeBusinessModules(base, ['service-desk'], {
        adoptExisting: ['customer-crm']
      })
      expect(result.ok).toBe(false)
      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(base).toEqual(before)
    }
  )

  test.each(['table', 'path', 'role'] as const)(
    'rejects an unrelated %s collision atomically',
    (kind) => {
      const base = notes()
      const entity = base.dataModel.entities[0]
      const apiResource = base.httpApi?.resources[0]
      if (!entity || !apiResource) throw new Error('Missing notes fixture')
      if (kind === 'table') entity.name = 'customers'
      if (kind === 'path') apiResource.path = '/customer-crm-users'
      if (kind === 'role') base.auth.roles.push({ id: 'custom-role', name: 'crm_manager' })
      const before = structuredClone(base)
      expect(() => composeBusinessModules(base, ['customer-crm'])).toThrow('already in use')
      expect(base).toEqual(before)
    }
  )

  test('does not let reserved module IDs impersonate a known business contract', () => {
    const base = notes()
    base.modules = {
      version: 1,
      modules: [
        {
          id: 'customer-crm',
          name: 'CRM',
          entityIds: base.dataModel.entities.map((entry) => entry.id),
          resourceIds: (base.httpApi?.resources ?? []).map((entry) => entry.id),
          commandIds: [],
          dependsOn: []
        }
      ]
    }
    expect(previewComposeBusinessModules(base, ['service-desk']).ok).toBe(false)
  })

  test('accepts canonicalized saved standalone data and preserves its exact existing representation', () => {
    const saved = composeBusinessModules(business(), ['customer-crm'], {
      adoptExisting: ['customer-crm']
    }).application
    const parsed = parseBackendApplicationSpecV1(saved)
    if (!parsed.ok) throw new Error('Invalid saved fixture')
    const base = parsed.value
    const before = structuredClone(base)
    const result = composeBusinessModules(base, ['service-desk'])
    for (const entity of before.dataModel.entities)
      expect(result.application.dataModel.entities.find((entry) => entry.id === entity.id)).toEqual(
        entity
      )
    expect(resource(result.application, 'users')).toEqual(resource(before, 'users'))
    expect(base).toEqual(before)
  })
  test('rejects an unscoped custom profile resource before adding any directory role policies', () => {
    const base = business()
    const api = base.httpApi
    if (!api) throw new Error('Missing fixture API')
    const custom = structuredClone(resource(base, 'users'))
    custom.id = 'custom-directory'
    custom.path = '/custom-directory'
    delete custom.readPolicyIds
    api.resources.push(custom)
    const before = structuredClone(base)
    const result = previewComposeBusinessModules(base, ['service-desk'], {
      adoptExisting: ['customer-crm']
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.message).toContain('explicitly select read policies')
    expect(base).toEqual(before)
  })

  test('rejects a reused command ID even when its custom path differs', () => {
    const base = business()
    const commands = base.commands
    if (!commands) throw new Error('Missing fixture commands')
    const existing = structuredClone(commands.commands[0])
    if (!existing) throw new Error('Missing fixture command')
    existing.id = 'create-ticket'
    existing.path = '/commands/custom-create'
    commands.commands.push(existing)
    const before = structuredClone(base)
    const result = previewComposeBusinessModules(base, ['service-desk'], {
      adoptExisting: ['customer-crm']
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.message).toContain('already in use')
    expect(base).toEqual(before)
  })
})
