import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { planNestJSLocalPreviewMigration } from '@open-pencil/compiler/backend'
import {
  deriveBackendApplicationCapabilities,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'
import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'

import { ESTABLISHED_BUSINESS_KINDS } from '#tests/engine/app/lowcode/backend/business/composition/helpers'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'module-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
function fixture() {
  const from = createBusinessApplication('module-migration-test', authentication, 'customer-crm')
  const to = composeBusinessModules(from, ESTABLISHED_BUSINESS_KINDS, {
    adoptExisting: ['customer-crm']
  }).application
  return { from, to }
}
async function migration(from: BackendApplicationSpecV1, to: BackendApplicationSpecV1) {
  const result = await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.plan
}
async function blocked(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1,
  code?: string
) {
  const result = await planNestJSLocalPreviewMigration({ fromApplication: from, toApplication: to })
  expect(result.ok).toBe(false)
  expect('plan' in result).toBe(false)
  if (!result.ok && code) expect(result.diagnostics.map((entry) => entry.code)).toContain(code)
}
function customer(application: BackendApplicationSpecV1) {
  const entity = application.dataModel.entities.find((entry) => entry.id === 'business-customers')
  if (!entity) throw new Error('Missing customers')
  return entity
}

describe('strictly additive managed module migrations', () => {
  test('creates enums and all tables before relational constraints while preserving old rows and ledger SQL', async () => {
    const { from, to } = fixture()
    const original = structuredClone({ from, to })
    const plan = await migration(from, to)
    expect({ from, to }).toEqual(original)
    expect(plan.operations).toHaveLength(1)
    const operation = plan.operations[0]
    if (!operation || operation.kind !== 'add-module-schema')
      throw new Error('Missing module schema operation')
    expect(operation.entityIds).toHaveLength(28)
    expect(operation.enumIds.length).toBeGreaterThan(0)
    expect(operation.moduleIds).toHaveLength(7)
    expect('entityId' in operation).toBe(false)
    const firstTable = plan.sql.indexOf('CREATE TABLE')
    const lastTable = plan.sql.lastIndexOf('CREATE TABLE')
    const firstForeignKey = plan.sql.indexOf(' FOREIGN KEY ')
    expect(plan.sql.lastIndexOf('CREATE TYPE')).toBeLessThan(firstTable)
    expect(firstForeignKey).toBeGreaterThan(lastTable)
    expect(plan.sql).toContain(' UNIQUE (')
    expect(plan.sql).toContain(' FOREIGN KEY (')
    expect(plan.sql).toContain('REFERENCES "public"."projects"')
    expect(plan.sql).not.toMatch(/^(?:DROP|RENAME|DELETE|UPDATE|INSERT)\s/mu)
    expect(plan.sql).not.toContain('_openpencil_command_ledger')
    expect(plan.sql).not.toContain('CREATE TABLE "public"."customers"')
    expect(plan.sql).not.toContain('ALTER TABLE "public"."users"')
    expect(plan.sql).not.toContain('ALTER TABLE "public"."customers"')
    expect(plan.requiresReview).toBe(true)
    expect(plan.warnings?.[0]).toContain('Complete outstanding commands')
    expect(plan.summary).toContain(plan.warnings?.[0])
    expect(plan.transactionRequired).toBe(true)
    expect(plan.scope).toBe('owned-local-preview')
    expect(plan.highestRisk).toBe('medium')
    expect(plan.sqlDigest).toBe(createHash('sha256').update(plan.sql).digest('base64url'))
    expect(Object.isFrozen(operation.entityIds)).toBe(true)
    expect(Object.isFrozen(plan)).toBe(true)
    from.dataModel.entities.reverse()
    to.dataModel.entities.reverse()
    expect(await migration(from, to)).toEqual(plan)
  })

  test.each(['single-merchant', 'multi-merchant'] as const)(
    'keeps %s financial and command ledgers unchanged when adding business modules',
    async (mode) => {
      const from = createCommerceOperationsApplication(
        'commerce-migration-test',
        authentication,
        mode
      )
      const to = composeBusinessModules(from, [
        'customer-crm',
        'service-desk',
        'content-knowledge-base'
      ]).application
      const plan = await migration(from, to)
      expect(plan.operations[0]?.kind).toBe('add-module-schema')
      expect(plan.sql).toContain('CREATE TABLE "public"."users"')
      expect(plan.sql).not.toContain('CREATE TABLE "public"."orders"')
      expect(plan.sql).not.toContain('ALTER TABLE "public"."stores"')
      expect(plan.sql).not.toMatch(/ledger/iu)
    }
  )

  test('allows a second append after explicit module adoption without reassigning existing modules', async () => {
    const base = fixture().from
    const from = composeBusinessModules(base, ['customer-crm'], {
      adoptExisting: ['customer-crm']
    }).application
    const to = composeBusinessModules(from, ['service-desk']).application
    const plan = await migration(from, to)
    const operation = plan.operations[0]
    if (!operation || operation.kind !== 'add-module-schema')
      throw new Error('Missing module operation')
    expect(operation.entityIds).toEqual(['business-ticket-history', 'business-tickets'])
    expect(operation.enumIds).toEqual(['ticket-status'])
    expect(operation.moduleIds).toEqual(['service-desk'])
  })

  test('adds isolated food tables to commerce while retaining existing financial and command ledgers', async () => {
    const from = createCommerceOperationsApplication(
      'food-commerce-migration',
      authentication,
      'single-merchant'
    )
    const to = composeBusinessModules(from, ['food-ordering']).application
    const plan = await migration(from, to)
    expect(plan.operations[0]?.kind).toBe('add-module-schema')
    expect(plan.sql).toContain('CREATE TABLE "public"."food_orders"')
    expect(plan.sql).not.toContain('CREATE TABLE "public"."orders"')
    expect(plan.sql).not.toMatch(/ledger/iu)
  })

  test.each([false, true])(
    'rejects changes to an existing food contract with additional module = %s',
    async (appendModule) => {
      const from = createBusinessApplication(
        'food-contract-migration',
        authentication,
        'food-ordering'
      )
      const to = appendModule
        ? composeBusinessModules(from, ['customer-crm'], { adoptExisting: ['food-ordering'] })
            .application
        : structuredClone(from)
      if (!to.foodOrdering) throw new Error('Missing food profile')
      to.foodOrdering.maxItems = 10
      await blocked(from, to, 'backend-local-migration-food-ordering-contract-change-blocked')
    }
  )

  test('rejects attaching food execution to pre-existing tables without a reviewed migration', async () => {
    const to = createBusinessApplication(
      'food-contract-attachment',
      authentication,
      'food-ordering'
    )
    const from = structuredClone(to)
    delete from.foodOrdering
    if (!from.commands || !to.commands) throw new Error('Missing commands')
    from.commands.commands = from.commands.commands.filter(
      (command) => !command.foodOrderingOperation
    )
    await blocked(from, to, 'backend-local-migration-food-ordering-contract-change-blocked')
  })

  test.each([
    'rename',
    'field',
    'enum',
    'constraint',
    'command',
    'policy',
    'role',
    'resource',
    'oidc',
    'jwt',
    'secret'
  ] as const)('rejects an accompanying existing %s change without partial SQL', async (change) => {
    const { from, to } = fixture()
    changeSchemaRecords(to, change)
    const api = to.httpApi
    if (!api?.browserClient) throw new Error('Missing API')
    if (change === 'resource') {
      const entry = api.resources.find((value) => value.id === 'users')
      if (!entry) throw new Error('Missing directory')
      entry.readPolicyIds?.push('support-manager-directory')
    }
    if (change === 'oidc') api.browserClient.authentication.clientId = 'another-client'
    if (change === 'jwt') api.authentication.algorithms = ['ES256']
    if (change === 'secret')
      to.secrets.push({
        kind: 'environment',
        name: 'NEW_SETTING',
        required: true,
        exposure: 'server'
      })
    await blocked(
      from,
      to,
      change === 'secret' ? undefined : 'backend-local-migration-module-schema-change-blocked'
    )
  })

  test.each(['existing-role', 'write-policy', 'hidden-field', 'unscoped-old-directory'] as const)(
    'rejects %s while adding a new directory to an existing entity',
    async (change) => {
      const { from, to } = fixture()
      const policy = to.auth.rowAccess.find((entry) => entry.id === 'support-manager-directory')
      const directory = to.httpApi?.resources.find((entry) => entry.id === 'service-desk-users')
      if (!policy || !directory) throw new Error('Missing directory fixture')
      if (change === 'existing-role') policy.principal = { kind: 'role', roleId: 'crm-manager' }
      if (change === 'write-policy') {
        to.auth.rowAccess.push({
          ...structuredClone(policy),
          id: 'new-directory-write',
          operations: ['update']
        })
      }
      if (change === 'hidden-field') directory.readFields.push('owner_id')
      if (change === 'unscoped-old-directory') {
        for (const app of [from, to]) {
          const old = app.httpApi?.resources.find((entry) => entry.id === 'users')
          if (!old) throw new Error('Missing old directory')
          delete old.readPolicyIds
        }
      }
      await blocked(from, to, 'backend-local-migration-module-schema-change-blocked')
    }
  )

  test('refuses to mutate an existing table through a newly added command', async () => {
    const { from, to } = fixture()
    const original = from.commands?.commands.find((entry) => entry.id === 'create-customer')
    const target = to.modules?.modules.find((entry) => entry.id === 'service-desk')
    if (!original || !to.commands || !target) throw new Error('Missing command fixture')
    const command = {
      ...structuredClone(original),
      id: 'new-customer-writer',
      path: '/commands/new-customer-writer'
    }
    to.commands.commands.push(command)
    target.commandIds.push(command.id)
    target.dependsOn.push('customer-crm')
    await blocked(from, to, 'backend-local-migration-module-schema-change-blocked')
  })

  test('refuses adding a module table into an existing module owner', async () => {
    const base = fixture().from
    const from = composeBusinessModules(base, ['customer-crm'], {
      adoptExisting: ['customer-crm']
    }).application
    const to = composeBusinessModules(from, ['service-desk']).application
    const crm = to.modules?.modules.find((entry) => entry.id === 'customer-crm')
    const support = to.modules?.modules.find((entry) => entry.id === 'service-desk')
    if (!crm || !support || !to.modules) throw new Error('Missing modules')
    reduceCRMCommands(from)
    reduceCRMCommands(to)
    crm.entityIds.push(...support.entityIds)
    crm.resourceIds.push(...support.resourceIds)
    crm.commandIds.push(...support.commandIds)
    to.modules.modules = to.modules.modules.filter((entry) => entry !== support)
    await blocked(from, to, 'backend-local-migration-module-schema-change-blocked')
  })

  test('keeps no-command to command-ledger creation explicitly blocked', async () => {
    const from = createNestJSNotesApplication('no-ledger-application')
    const client = from.httpApi?.browserClient
    if (!client) throw new Error('Missing OIDC')
    client.authentication = structuredClone(authentication)
    from.capabilities = deriveBackendApplicationCapabilities(from).map((capability) => ({
      capability,
      required: true
    }))
    const to = composeBusinessModules(from, ['customer-crm']).application
    await blocked(from, to, 'backend-local-migration-command-ledger-change-blocked')
  })

  test('does not permit advanced schema additions without an explicit valid module partition', async () => {
    const { from, to } = fixture()
    const next = composeBusinessModules(from, ['service-desk'], {
      adoptExisting: ['customer-crm']
    }).application
    reduceCRMCommands(from)
    reduceCRMCommands(next)
    delete next.modules
    await blocked(from, next, 'backend-local-migration-relational-schema-change-blocked')
    const entry = to.modules?.modules[0]
    if (!entry) throw new Error('Missing module')
    entry.entityIds = []
    await blocked(from, to)
  })
})

function reduceCRMCommands(application: BackendApplicationSpecV1): void {
  const original = createBusinessApplication('ids-only', authentication, 'customer-crm')
  const removed = new Set(
    (original.commands?.commands ?? [])
      .map((entry) => entry.id)
      .filter((id) => !['create-customer', 'register-business-user'].includes(id))
  )
  if (application.commands)
    application.commands.commands = application.commands.commands.filter(
      (entry) => !removed.has(entry.id)
    )
  for (const module of application.modules?.modules ?? [])
    module.commandIds = module.commandIds.filter((id) => !removed.has(id))
}

function changeSchemaRecords(to: BackendApplicationSpecV1, change: string): void {
  if (change === 'rename') customer(to).name = 'renamed_customers'
  if (change === 'field') {
    const field = customer(to).fields.find((entry) => entry.id === 'title')
    if (!field) throw new Error('Missing title')
    field.nullable = true
  }
  if (change === 'enum') {
    const entry = to.dataModel.enums.find((value) => value.id === 'customer-stage')
    if (!entry) throw new Error('Missing stage')
    entry.values.push('custom_stage')
  }
  if (change === 'constraint') customer(to).indexes = []
  if (change === 'command') {
    const entry = to.commands?.commands.find((value) => value.id === 'create-customer')
    if (!entry) throw new Error('Missing command')
    entry.name = 'Changed command'
  }
  if (change === 'policy') {
    const entry = to.auth.rowAccess.find((value) => value.id === 'crm-manager-customers')
    if (!entry) throw new Error('Missing policy')
    entry.conditions = [{ fieldId: 'version', value: 0 }]
  }
  if (change === 'role') {
    const entry = to.auth.roles.find((value) => value.id === 'crm-manager')
    if (!entry) throw new Error('Missing role')
    entry.name = 'custom_manager'
  }
}
