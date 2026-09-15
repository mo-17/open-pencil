import { describe, expect, test } from 'bun:test'

import { planNestJSLocalPreviewMigration } from '@open-pencil/compiler/backend'
import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import { createAssetsApplication } from '@/app/lowcode/backend/business/model/assets/application'
import {
  ASSET_REQUEST_STATUSES,
  ASSET_STATUSES
} from '@/app/lowcode/backend/business/model/assets/fields'

import { modelFiles } from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'asset-test',
  scopes: ['openid'],
  callbackPath: '/_openpencil/auth/callback'
}
const assets = () => createAssetsApplication('asset-test', authentication)
function command(application: BackendApplicationSpecV1, id: string) {
  const found = application.commands?.commands.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing asset command ' + id)
  return found
}
function resource(application: BackendApplicationSpecV1, id: string) {
  const found = application.httpApi?.resources.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing asset resource ' + id)
  return found
}
const requestCommands = [
  'cancel-asset-request',
  'reject-asset-request',
  'issue-asset-assignment',
  'issue-asset-loan',
  'return-asset-request'
]

describe('individual asset management model', () => {
  test('stays in the ordinary bounded transaction DSL with private business reads and no direct writes', () => {
    const application = assets()
    const parsed = parseBackendApplicationSpecV1(application)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(application.dataModel.entities).toHaveLength(4)
    expect(application.commands?.commands).toHaveLength(13)
    expect(application.httpApi?.resources).toHaveLength(7)
    expect(application.auth.roles.map((role) => role.id)).toEqual(['asset-manager'])
    for (const operation of application.commands?.commands ?? []) {
      expect(operation.steps.length).toBeLessThanOrEqual(32)
      expect(operation.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
      expect(operation.commerceOperation).toBeUndefined()
      expect(operation.foodOrderingOperation).toBeUndefined()
      expect(
        operation.parameters.some((parameter) =>
          /owner|custodian|registeredBy|status/.test(parameter.name)
        )
      ).toBe(false)
    }
    for (const entry of application.httpApi?.resources ?? []) {
      expect(entry.operations.every((operation) => ['list', 'read'].includes(operation))).toBe(true)
      expect(entry.readFields).not.toContain('owner_id')
    }
    expect(application.auth.rowAccess.some((policy) => policy.principal.kind === 'anonymous')).toBe(
      false
    )
    expect(
      command(application, 'register-business-user').parameters.map((parameter) => parameter.name)
    ).toEqual(['title'])
  })

  test('separates available catalog, owner requests and administrator custody/audit projections', () => {
    const application = assets()
    const policy = (id: string) =>
      application.auth.rowAccess.filter((entry) =>
        resource(application, id).readPolicyIds?.includes(entry.id)
      )
    expect(policy('assets')).toMatchObject([
      {
        principal: { kind: 'authenticated' },
        conditions: [{ fieldId: 'status', value: 'available' }]
      }
    ])
    expect(resource(application, 'assets').readFields).not.toContain('custodian_subject')
    expect(resource(application, 'assets').readFields).not.toContain('current_request_id')
    expect(policy('asset-requests').map((entry) => entry.principal.kind)).toEqual(['owner'])
    for (const id of ['asset-management', 'asset-management-requests', 'asset-history'])
      expect(policy(id).map((entry) => entry.principal)).toEqual([
        { kind: 'role', roleId: 'asset-manager' }
      ])
    expect(resource(application, 'asset-management').readFields).toEqual(
      expect.arrayContaining(['registered_by', 'custodian_subject', 'current_request_id'])
    )
    expect(resource(application, 'asset-history').readFields).toContain('actor_subject')
  })

  test('locks existing requests before their asset consistently and checks immutable association before changes', () => {
    const application = assets()
    for (const id of requestCommands) {
      const operation = command(application, id)
      expect(operation.access).toMatchObject({
        kind: 'row-policy',
        entityId: 'business-asset-requests',
        parameter: 'requestId'
      })
      expect(
        operation.steps
          .filter((step) => step.kind === 'data.read')
          .map((step) => [step.resultName, step.lock])
      ).toEqual([
        ['request', 'update'],
        ['asset', 'update']
      ])
      expect(operation.steps.map((step) => step.id)).toEqual(
        expect.arrayContaining(['request_asset_matches', 'request_version'])
      )
    }
    expect(command(application, 'cancel-asset-request').access).toMatchObject({
      policyIds: ['own-asset-requests']
    })
    const cancel = command(application, 'cancel-asset-request').steps.find(
      (step) => step.kind === 'data.read' && step.resultName === 'request'
    )
    expect(cancel).toMatchObject({ scope: 'owner' })
    for (const id of requestCommands.filter((id) => id !== 'cancel-asset-request'))
      expect(command(application, id).access).toMatchObject({
        roleId: 'asset-manager',
        policyIds: ['manage-asset-requests']
      })
    for (const id of [
      'update-asset',
      'start-asset-repair',
      'complete-asset-repair',
      'retire-asset'
    ])
      expect(
        command(application, id)
          .steps.filter((step) => step.kind === 'data.read')
          .map((step) => step.resultName)
      ).toEqual(['asset'])
  })

  test('ensures one actual custodian and only the matching issued request can clear it', () => {
    const application = assets()
    expect(
      application.dataModel.entities.find((entity) => entity.name === 'assets')?.uniques
    ).toContainEqual({ id: 'unique-asset-tag', fields: ['tag'] })
    expect(
      application.dataModel.enums.find((entry) => entry.id === 'asset-status')?.values
    ).toEqual([...ASSET_STATUSES])
    expect(
      application.dataModel.enums.find((entry) => entry.id === 'asset-request-status')?.values
    ).toEqual([...ASSET_REQUEST_STATUSES])
    for (const id of ['issue-asset-assignment', 'issue-asset-loan']) {
      const operation = command(application, id)
      expect(operation.steps.map((step) => step.id)).toEqual(
        expect.arrayContaining([
          'asset_status',
          'request_status',
          'no_current_request',
          'no_custodian'
        ])
      )
      const update = operation.steps.find(
        (step) => step.kind === 'data.mutate' && step.resultName === 'updated_asset'
      )
      if (update?.kind !== 'data.mutate') throw new Error('Missing asset handover')
      expect(update.values).toContainEqual({
        field: 'custodian_subject',
        value: { kind: 'result', name: 'request', field: 'owner_id' }
      })
      expect(update.values).toContainEqual({
        field: 'current_request_id',
        value: { kind: 'result', name: 'request', field: 'id' }
      })
    }
    const returned = command(application, 'return-asset-request')
    expect(returned.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining(['current_request_matches', 'custodian_matches'])
    )
    const update = returned.steps.find(
      (step) => step.kind === 'data.mutate' && step.resultName === 'updated_asset'
    )
    if (update?.kind !== 'data.mutate') throw new Error('Missing returned asset')
    expect(update.values).toEqual(
      expect.arrayContaining([
        { field: 'custodian_subject', value: { kind: 'literal', value: null } },
        { field: 'current_request_id', value: { kind: 'literal', value: null } }
      ])
    )
    for (const id of ['start-asset-repair', 'retire-asset'])
      expect(command(application, id).steps.map((step) => step.id)).toEqual(
        expect.arrayContaining(['no_current_request', 'no_custodian', 'asset_version'])
      )
  })

  test('rechecks the immutable loan deadline and never accepts client-supplied custody or audit attribution', () => {
    const application = assets()
    const loan = command(application, 'issue-asset-loan')
    expect(loan.parameters.find((parameter) => parameter.name === 'dueAt')).toEqual({
      name: 'dueAt',
      type: 'datetime',
      required: true
    })
    expect(loan.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining(['original_loan_due', 'future_loan_due'])
    )
    expect(
      command(application, 'request-asset-loan').steps.some((step) => step.id === 'future_loan_due')
    ).toBe(true)
    expect(
      command(application, 'request-asset-assignment').parameters.some(
        (parameter) => parameter.name === 'dueAt'
      )
    ).toBe(false)
    const changed = assets()
    const issue = command(changed, 'issue-asset-assignment')
    issue.parameters.push({ name: 'ownerId', type: 'uuid', required: true })
    const audit = issue.steps.find(
      (step) => step.kind === 'data.mutate' && step.entityId === 'business-asset-history'
    )
    if (audit?.kind !== 'data.mutate') throw new Error('Missing audit')
    const owner = audit.values.find((value) => value.field === 'owner_id')
    if (!owner) throw new Error('Missing audit owner')
    owner.value = { kind: 'parameter', name: 'ownerId' }
    expect(parseBackendApplicationSpecV1(changed).ok).toBe(false)
  })

  test('audits all asset commands transactionally and emits the real trusted NestJS plans', () => {
    const application = assets()
    for (const operation of application.commands?.commands.filter(
      (entry) => entry.id !== 'register-business-user'
    ) ?? []) {
      const audit = operation.steps.filter(
        (step) => step.kind === 'data.mutate' && step.entityId === 'business-asset-history'
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({ operation: 'insert' })
    }
    const files = modelFiles(application)
    const sql = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(sql).toContain('UNIQUE ("tag")')
    expect(sql).toContain('"asset_requests"')
    expect(sql).toContain('"asset_history"')
    const plans = files.get('backend/nestjs/src/command-plans.ts')
    expect(plans).toContain('issue-asset-loan')
    expect(plans).toContain('custodian_subject')
    expect(files.get('backend/nestjs/src/command.service.ts')).toContain('executeCommand')
    expect(files.has('backend/nestjs/src/asset-execution.ts')).toBe(false)
  })

  test('composes additively with inventory while keeping asset and stock data independent', async () => {
    const from = createBusinessApplication(
      'asset-inventory',
      authentication,
      'procurement-inventory'
    )
    const before = structuredClone(from)
    const to = composeBusinessModules(from, ['procurement-inventory', 'asset-management'], {
      adoptExisting: ['procurement-inventory']
    }).application
    expect(from).toEqual(before)
    expect(parseBackendApplicationSpecV1(to).diagnostics).toEqual([])
    const module = to.modules?.modules.find((entry) => entry.id === 'asset-management')
    expect(module?.entityIds).toHaveLength(3)
    expect(module?.commandIds).toHaveLength(12)
    expect(module?.dependsOn).toEqual(['shared-accounts'])
    for (const policy of before.auth.rowAccess)
      expect(to.auth.rowAccess.find((entry) => entry.id === policy.id)).toEqual(policy)
    const migration = await planNestJSLocalPreviewMigration({
      fromApplication: from,
      toApplication: to
    })
    expect(migration.ok, migration.ok ? undefined : JSON.stringify(migration.diagnostics)).toBe(
      true
    )
    if (!migration.ok) throw new Error('Asset addition was not additive')
    expect(migration.plan.sql).toContain('CREATE TABLE "public"."asset_requests"')
    expect(migration.plan.sql).not.toContain('ALTER TABLE "public"."inventory_balances"')
  })
})
