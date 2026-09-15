import { describe, expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { createContractsApplication } from '@/app/lowcode/backend/business/model/contracts/application'

import { modelFiles } from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

const create = () =>
  createContractsApplication('contracts-tests', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'contracts-tests',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
const command = (app: BackendApplicationSpecV1, id: string) => {
  const entry = app.commands?.commands.find((value) => value.id === id)
  if (!entry) throw new Error('Missing contract command ' + id)
  return entry
}

describe('quotation and contract model', () => {
  test('strictly parses a bounded independent application without financial runtime or CRM dependency', () => {
    const app = create()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(app.dataModel.entities.map((entity) => entity.name)).toEqual([
      'users',
      'contract_parties',
      'quote_drafts',
      'quote_versions',
      'contracts',
      'contract_deliveries',
      'contract_history'
    ])
    expect(app.commands?.commands).toHaveLength(11)
    expect(app.httpApi?.resources).toHaveLength(8)
    expect(app.auth.roles.map((role) => role.id)).toEqual(['contract-manager'])
    expect(app.commerce).toBeUndefined()
    for (const entry of app.commands?.commands ?? []) {
      expect(entry.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
      expect(entry.steps.length).toBeLessThanOrEqual(32)
      if (entry.id !== 'register-business-user')
        expect(entry.access).toMatchObject({ roleId: 'contract-manager' })
    }
  })

  test('requires both ownership and current role for internal resource reads and hides ownership fields', () => {
    const app = create()
    for (const resource of app.httpApi?.resources.filter(
      (value) => !['users', 'my-profile'].includes(value.id)
    ) ?? []) {
      expect(resource.operations).toEqual(['list', 'read'])
      expect(resource.readFields).not.toContain('owner_id')
      expect(resource.readPolicyIds).toHaveLength(1)
      const policy = app.auth.rowAccess.find((value) => value.id === resource.readPolicyIds?.[0])
      expect(policy?.principal).toEqual({
        kind: 'related-member',
        entityFieldId: 'id',
        membershipEntityId: resource.entityId,
        membershipFieldId: 'id',
        identityFieldId: 'owner_id',
        roleId: 'contract-manager'
      })
    }
    expect(app.auth.rowAccess.some((policy) => policy.principal.kind === 'anonymous')).toBe(false)
  })

  test('computes bounded integer totals on the server and resolves counterparty ownership', () => {
    const app = create()
    for (const id of ['create-quote-draft', 'update-quote-draft']) {
      const entry = command(app, id)
      expect(entry.parameters.map((parameter) => parameter.name)).not.toContain('totalCents')
      expect(entry.parameters).toContainEqual({
        name: 'unitPriceCents',
        type: 'integer',
        required: true,
        min: 0,
        max: 1000000
      })
      expect(entry.steps).toContainEqual(
        expect.objectContaining({
          kind: 'data.read',
          resultName: 'party',
          scope: 'owner',
          lock: 'update'
        })
      )
      const total = entry.steps.find((step) => step.kind === 'assert' && step.operator === 'lte')
      expect(total).toMatchObject({
        left: { kind: 'integer-arithmetic', operator: 'multiply' },
        right: { kind: 'literal', value: 1000000000 }
      })
    }
  })

  test('freezes quotation rows and rejects mismatched, superseded, edited or duplicate confirmation', () => {
    const app = create()
    const versions = app.dataModel.entities.find((entity) => entity.name === 'quote_versions')
    if (!versions) throw new Error('Missing quote versions entity')
    expect(versions.uniques).toContainEqual({
      id: 'draft-revision',
      fields: ['draft_id', 'revision']
    })
    for (const entry of app.commands?.commands ?? [])
      expect(
        entry.steps.some(
          (step) =>
            step.kind === 'data.mutate' &&
            step.entityId === versions.id &&
            step.operation !== 'insert'
        )
      ).toBe(false)
    const confirm = command(app, 'confirm-quote-contract')
    for (const id of [
      'expected_version',
      'unconfirmed_draft',
      'quote_matches_draft',
      'latest_quote',
      'unchanged_published_draft',
      'nonempty_reference'
    ])
      expect(confirm.steps.some((step) => step.id === id)).toBe(true)
    expect(
      confirm.steps.find((step) => step.kind === 'data.mutate' && step.resultName === 'contract')
    ).toMatchObject({
      values: expect.arrayContaining([
        { field: 'total_cents', value: { kind: 'result', name: 'quote', field: 'total_cents' } },
        { field: 'party_id', value: { kind: 'result', name: 'quote', field: 'party_id' } }
      ])
    })
    const contracts = app.dataModel.entities.find((entity) => entity.name === 'contracts')
    if (!contracts) throw new Error('Missing contracts entity')
    expect(contracts.uniques).toEqual(
      expect.arrayContaining([
        { id: 'one-per-draft', fields: ['draft_id'] },
        { id: 'one-per-quote', fields: ['quote_version_id'] }
      ])
    )
    for (const entity of [versions, contracts])
      expect(
        entity.foreignKeys?.every(
          (key) => key.fields.includes('owner_id') && key.targetFields.includes('owner_id')
        )
      ).toBe(true)
  })

  test('serializes delivery and acceptance on the contract before enforcing parent, quantity and sequence', () => {
    const app = create()
    for (const id of [
      'record-contract-delivery',
      'accept-contract-delivery',
      'close-contract',
      'cancel-contract'
    ]) {
      const entry = command(app, id)
      expect(entry.steps[0]).toMatchObject({
        kind: 'data.read',
        entityId: 'business-contracts',
        resultName: 'contract',
        lock: 'update'
      })
      expect(entry.steps[1]).toMatchObject({
        id: 'expected_version',
        right: { kind: 'parameter', name: 'expectedVersion' }
      })
      expect(entry.steps[2]).toMatchObject({
        id: 'active_contract',
        right: { kind: 'literal', value: 'active' }
      })
      expect(
        entry.steps.filter(
          (step) => step.kind === 'data.mutate' && step.entityId === 'business-contract-history'
        )
      ).toHaveLength(1)
    }
    const accept = command(app, 'accept-contract-delivery')
    const assertions = accept.steps.filter((step) => step.kind === 'assert')
    expect(assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          left: { kind: 'result', name: 'delivery', field: 'contract_id' },
          right: { kind: 'result', name: 'contract', field: 'id' }
        }),
        expect.objectContaining({
          left: { kind: 'result', name: 'delivery', field: 'sequence' },
          right: { kind: 'result', name: 'contract', field: 'next_accept_sequence' }
        }),
        expect.objectContaining({
          left: { kind: 'result', name: 'delivery', field: 'status' },
          right: { kind: 'literal', value: 'submitted' }
        })
      ])
    )
    expect(
      command(app, 'close-contract')
        .steps.filter((step) => step.kind === 'assert')
        .map((step) => step.id)
    ).toEqual([
      'expected_version',
      'active_contract',
      'nonempty_reference',
      'fully_delivered',
      'fully_accepted',
      'all_stages_accepted'
    ])
    expect(command(app, 'cancel-contract').steps.some((step) => step.id === 'nonempty_note')).toBe(
      true
    )
    expect(
      app.commands?.commands
        .flatMap((entry) => entry.steps)
        .some((step) => step.kind === 'data.mutate' && step.operation === 'delete')
    ).toBe(false)
  })

  test('emits trusted runnable NestJS plans and SQL with immutable snapshot and revision constraints', () => {
    const files = modelFiles(create())
    const sql = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(sql).toContain('quote_versions')
    expect(sql).toContain('contract_deliveries')
    const plans = files.get('backend/nestjs/src/command-plans.ts')
    expect(plans).toContain('confirm-quote-contract')
    expect(plans).toContain('next_accept_sequence')
    expect(plans).toContain('expectedVersion')
    expect(files.has('backend/nestjs/src/command-execution.ts')).toBe(true)
  })
})
