import { describe, expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { createApprovalsApplication } from '@/app/lowcode/backend/business/model/approvals/application'
import {
  APPROVALS_KINDS,
  APPROVALS_ROLES,
  APPROVALS_STATUSES
} from '@/app/lowcode/backend/business/model/approvals/fields'

import { modelFiles } from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

const create = () =>
  createApprovalsApplication('approvals-contract', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'approvals-test',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
const command = (app: BackendApplicationSpecV1, id: string) => {
  const value = app.commands?.commands.find((entry) => entry.id === id)
  if (!value) throw new Error('Missing approval command ' + id)
  return value
}
const resource = (app: BackendApplicationSpecV1, id: string) => {
  const value = app.httpApi?.resources.find((entry) => entry.id === id)
  if (!value) throw new Error('Missing approval resource ' + id)
  return value
}

describe('enterprise approval model', () => {
  test('parses a bounded ordinary command application with three records and no payment engine', () => {
    const app = create()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(app.dataModel.entities.map((entity) => entity.name)).toEqual([
      'users',
      'oa_requests',
      'oa_request_history'
    ])
    expect(app.commands?.commands).toHaveLength(14)
    expect(app.httpApi?.resources).toHaveLength(9)
    expect(app.auth.roles.map((role) => role.id)).toEqual([...APPROVALS_ROLES])
    expect(app.dataModel.enums.find((entry) => entry.id === 'oa-request-kind')?.values).toEqual([
      ...APPROVALS_KINDS
    ])
    expect(app.dataModel.enums.find((entry) => entry.id === 'oa-request-status')?.values).toEqual([
      ...APPROVALS_STATUSES
    ])
    expect(app.commerce).toBeUndefined()
    expect(app.foodOrdering).toBeUndefined()
    for (const entry of app.commands?.commands ?? []) {
      expect(entry.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
      expect(entry.commerceOperation).toBeUndefined()
      expect(entry.foodOrderingOperation).toBeUndefined()
      expect(entry.steps.length).toBeLessThanOrEqual(32)
    }
  })

  test('uses private owner drafts and stage-bound role queues, without exposing command-only grants', () => {
    const app = create()
    for (const id of [
      'oa-requests',
      'oa-history',
      ...APPROVALS_KINDS.map((kind) => `oa-${kind}-requests`)
    ]) {
      const ids = resource(app, id).readPolicyIds ?? []
      expect(
        app.auth.rowAccess
          .filter((policy) => ids.includes(policy.id))
          .every((policy) => policy.principal.kind === 'owner')
      ).toBe(true)
    }
    for (const [index, level] of ['first', 'second'].entries()) {
      expect(app.auth.rowAccess.find((policy) => policy.id === `oa-${level}-queue`)).toMatchObject({
        principal: { kind: 'role', roleId: APPROVALS_ROLES[index] },
        conditions: [{ fieldId: 'status', value: `pending_${level}` }]
      })
      for (const entry of app.httpApi?.resources ?? [])
        expect(entry.readPolicyIds).not.toContain(`oa-${level}-command`)
    }
    expect(app.auth.rowAccess.some((policy) => policy.principal.kind === 'anonymous')).toBe(false)
    for (const entry of app.httpApi?.resources ?? []) {
      expect(entry.readFields).not.toContain('owner_id')
      expect(entry.operations).toEqual(['list', 'read'])
    }
  })

  test('fixes request kind and applicant on the server and validates dates and integer amounts', () => {
    const app = create()
    for (const kind of APPROVALS_KINDS) {
      const createCommand = command(app, `create-oa-${kind}`)
      expect(createCommand.access).toEqual({ kind: 'authenticated' })
      expect(createCommand.parameters.map((parameter) => parameter.name)).toEqual([
        'title',
        'description',
        ...(kind === 'leave' ? ['startsAt', 'endsAt'] : ['amountCents'])
      ])
      const insert = createCommand.steps.find(
        (step) => step.kind === 'data.mutate' && step.resultName === 'request'
      )
      expect(insert).toMatchObject({
        values: expect.arrayContaining([
          { field: 'owner_id', value: { kind: 'caller-sub' } },
          { field: 'applicant_subject', value: { kind: 'caller-sub' } },
          { field: 'kind', value: { kind: 'literal', value: kind } }
        ])
      })
      expect(command(app, `update-oa-${kind}`).steps).toContainEqual(
        expect.objectContaining({
          id: 'expected_kind',
          operator: 'eq',
          right: { kind: 'literal', value: kind }
        })
      )
      if (kind === 'leave')
        expect(
          createCommand.steps.filter((step) => step.kind === 'assert').map((step) => step.id)
        ).toEqual(['nonempty_title', 'ordered_dates', 'positive_duration'])
      else
        expect(
          createCommand.parameters.find((parameter) => parameter.name === 'amountCents')
        ).toMatchObject({ type: 'integer', min: 1, max: 100000000 })
    }
  })

  test('locks and compares every selected revision before updates with one immutable audit event', () => {
    const app = create()
    for (const entry of app.commands?.commands.filter(
      (value) => value.id !== 'register-business-user'
    ) ?? []) {
      const audit = entry.steps.filter(
        (step) => step.kind === 'data.mutate' && step.entityId === 'business-oa-request-history'
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        operation: 'insert',
        values: expect.arrayContaining([{ field: 'actor_subject', value: { kind: 'caller-sub' } }])
      })
      if (entry.id.startsWith('create-')) continue
      expect(entry.parameters).toContainEqual({
        name: 'expectedVersion',
        type: 'integer',
        required: true,
        min: 0,
        max: 2147483647
      })
      expect(entry.steps[0]).toMatchObject({
        kind: 'data.read',
        lock: 'update',
        entityId: 'business-oa-requests'
      })
      expect(entry.steps[1]).toMatchObject({
        id: 'expected_version',
        kind: 'assert',
        operator: 'eq',
        left: { kind: 'result', name: 'request', field: 'version' },
        right: { kind: 'parameter', name: 'expectedVersion' }
      })
      expect(entry.steps.at(-1)).toMatchObject({
        operation: 'update',
        values: expect.arrayContaining([
          {
            field: 'version',
            value: {
              kind: 'integer-arithmetic',
              operator: 'add',
              left: { kind: 'result', name: 'request', field: 'version' },
              right: { kind: 'literal', value: 1 }
            }
          }
        ])
      })
    }
    const history = app.dataModel.entities.find((entity) => entity.name === 'oa_request_history')
    expect(history?.uniques).toContainEqual({
      id: 'request-revision',
      fields: ['request_id', 'after_version']
    })
    expect(history?.foreignKeys).toContainEqual(
      expect.objectContaining({
        fields: ['request_id', 'owner_id'],
        targetFields: ['id', 'owner_id'],
        onDelete: 'restrict'
      })
    )
  })

  test('requires two distinct non-applicant reviewers and a reason for either rejection', () => {
    const app = create()
    for (const [index, level] of ['first', 'second'].entries()) {
      for (const decision of ['approve', 'reject']) {
        const entry = command(app, `${decision}-oa-${level}`)
        expect(entry.access).toMatchObject({
          kind: 'row-policy',
          roleId: APPROVALS_ROLES[index],
          policyIds: [`oa-${level}-command`]
        })
        expect(entry.steps).toContainEqual(
          expect.objectContaining({
            id: 'not_applicant',
            operator: 'neq',
            left: { kind: 'result', name: 'request', field: 'owner_id' },
            right: { kind: 'caller-sub' }
          })
        )
        expect(entry.steps).toContainEqual(
          expect.objectContaining({
            id: 'expected_status',
            right: { kind: 'literal', value: `pending_${level}` }
          })
        )
        if (index === 1) {
          expect(entry.steps).toContainEqual(
            expect.objectContaining({
              id: 'different_reviewer',
              operator: 'neq',
              right: { kind: 'caller-sub' }
            })
          )
          expect(entry.steps).toContainEqual(
            expect.objectContaining({
              id: 'first_review_complete',
              operator: 'neq',
              right: { kind: 'literal', value: null }
            })
          )
        }
        expect(entry.steps.some((step) => step.id === 'rejection_reason')).toBe(
          decision === 'reject'
        )
      }
    }
  })

  test('reopens only rejected requests and restarts both reviews while retaining old audit rows', () => {
    const app = create()
    expect(command(app, 'reopen-oa-request').steps).toContainEqual(
      expect.objectContaining({
        id: 'expected_status',
        right: { kind: 'literal', value: 'rejected' }
      })
    )
    for (const id of ['reopen-oa-request', 'submit-oa-request']) {
      const update = command(app, id).steps.at(-1)
      expect(update).toMatchObject({
        values: expect.arrayContaining(
          ['first_reviewer_subject', 'second_reviewer_subject'].map((field) => ({
            field,
            value: { kind: 'literal', value: null }
          }))
        )
      })
    }
    expect(
      command(app, 'cancel-oa-request')
        .steps.filter((step) => step.kind === 'assert')
        .map((step) => step.id)
    ).toEqual(['expected_version', 'not_approved', 'not_cancelled'])
    for (const id of ['submit-oa-request', 'reopen-oa-request', 'cancel-oa-request'])
      expect(command(app, id).access).toMatchObject({ policyIds: ['own-oa-requests'] })
  })

  test('emits runnable reviewed NestJS source and SQL ownership for the three entities', () => {
    const files = modelFiles(create())
    const sql = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(typeof sql).toBe('string')
    expect(sql).toContain('oa_requests')
    expect(sql).toContain('oa_request_history')
    const plans = files.get('backend/nestjs/src/command-plans.ts')
    expect(plans).toContain('approve-oa-second')
    expect(plans).toContain('expectedVersion')
    if (typeof plans !== 'string') throw new Error('Missing approval command plans')
    const emitted = JSON.parse(
      plans.slice(plans.indexOf('= {') + 2, plans.lastIndexOf('} as const') + 1)
    )
    for (const id of ['approve-oa-second', 'reject-oa-second']) {
      expect(emitted[id].steps).toContainEqual({
        kind: 'assert',
        left: { kind: 'result', name: 'request', field: 'first_reviewer_subject' },
        right: { kind: 'caller-sub' },
        operator: 'neq',
        error: 'conflict'
      })
    }
    expect(files.has('backend/nestjs/src/command-execution.ts')).toBe(true)
  })
})
