import { describe, expect, test } from 'bun:test'

import { buildBackendClientRuntime } from '#compiler/adapters/backend-client/runtime'
import { emitNestJSClient } from '#compiler/backend/nestjs/client'
import { nestJSCommandDefinitionDigest } from '#compiler/backend/nestjs/commands/plan'
import { emitNestJSController } from '#compiler/backend/nestjs/controller'
import { nestJSResources } from '#compiler/backend/nestjs/model'
import { replaceTenantSource } from '#compiler/backend/nestjs/tenant/source'
import { validateNestJSApplication } from '#compiler/backend/nestjs/validation'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { tenantApplication } from './helpers'

describe('bounded NestJS tenant and resource policy contracts', () => {
  test('accepts store-backed UUID tenancy and narrows resource read grants without changing public storefronts', () => {
    const app = tenantApplication()
    app.httpApi?.resources.push({
      id: 'my-store',
      path: '/my-store',
      entityId: 'stores',
      operations: ['list', 'read'],
      readFields: ['id', 'title'],
      maxPageSize: 25,
      readPolicyIds: ['own-store']
    })
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(validateNestJSApplication(app)).toEqual([])
    const models = nestJSResources(app)
    const mine = models.find((model) => model.resource.id === 'my-store')
    const publicStore = models.find((model) => model.resource.id === 'stores')
    if (!mine || !publicStore) throw new Error('Missing scoped resource.')
    expect(mine.authorization.select).toEqual({ owner: true, public: false, roles: [] })
    expect(publicStore.authorization.select.public).toBe(true)
    expect(String(emitNestJSController(mine, 0)[0].content)).not.toContain('@PublicRead()')
    const client = String(emitNestJSClient(app).content)
    expect(client).toContain('"/my-store" + pagination(query))')
    expect(client).toContain('"/stores" + pagination(query), undefined, true)')
    expect(buildBackendClientRuntime(app, './lowcode-state')).toContain(
      'const publicResources: readonly string[] = ["stores"]'
    )
  })

  test.each([
    'incomplete',
    'nullable',
    'wrong-type',
    'non-unique-owner',
    'no-foreign-key',
    'mixed-insert-grants',
    'mutable-store'
  ])('rejects %s tenant locators', (fault) => {
    const app = tenantApplication()
    const tenant = app.auth.tenants[0]
    const stores = app.dataModel.entities[1]
    if (fault === 'incomplete') delete tenant.membershipIdentityFieldId
    if (fault === 'nullable') stores.fields[1].nullable = true
    if (fault === 'wrong-type') stores.fields[1].type = 'string'
    if (fault === 'non-unique-owner') stores.uniques = []
    if (fault === 'no-foreign-key') app.dataModel.entities[0].foreignKeys = []
    if (fault === 'mixed-insert-grants') app.auth.rowAccess[0].operations.push('insert')
    if (fault === 'mutable-store') app.httpApi?.resources[1].operations.push('delete')
    expect(
      validateNestJSApplication(app).some((diagnostic) => diagnostic.path.includes('tenants'))
    ).toBe(true)
  })

  test('includes membership mapping in command digests and fails closed on template drift', () => {
    const app = tenantApplication()
    const command = app.commands?.commands[0]
    if (!command) throw new Error('Missing command.')
    const digest = nestJSCommandDefinitionDigest(app, command)
    app.auth.tenants[0].membershipIdentityFieldId = 'different_owner'
    expect(nestJSCommandDefinitionDigest(app, command)).not.toBe(digest)
    expect(() => replaceTenantSource('missing', 'guard', 'safe')).toThrow()
    expect(() => replaceTenantSource('guard guard', 'guard', 'safe')).toThrow()
  })
})
