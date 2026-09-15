import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createRecruitmentApplication } from '@/app/lowcode/backend/business/model/recruitment/application'

import {
  modelFiles,
  modelRequired
} from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'recruitment-contract',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const application = () => createRecruitmentApplication('recruitment-test', authentication)
const command = (id: string) =>
  modelRequired(application().commands?.commands.find((entry) => entry.id === id))

describe('private HR recruitment and employee lifecycle contract', () => {
  test('uses bounded ordinary commands, existing identity and read-only resources', () => {
    const app = application()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(app.dataModel.entities).toHaveLength(7)
    expect(app.commands?.commands).toHaveLength(14)
    expect(app.httpApi?.resources).toHaveLength(8)
    expect(app.auth.roles.map((role) => role.id)).toEqual(['recruitment-hr'])
    expect(app.httpApi?.browserClient?.authentication).toEqual(authentication)
    for (const entry of app.commands?.commands ?? []) {
      expect(entry.steps.length).toBeLessThanOrEqual(32)
      expect(entry.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
      expect(entry.foodOrderingOperation).toBeUndefined()
      expect(entry.commerceOperation).toBeUndefined()
      expect(entry.parameters.map((parameter) => parameter.name)).not.toContain('ownerId')
    }
    for (const resource of app.httpApi?.resources ?? []) {
      expect(resource.operations).toEqual(['list', 'read'])
      expect(resource.readFields).not.toContain('owner_id')
    }
    expect(
      app.dataModel.entities
        .find((entity) => entity.name === 'users')
        ?.fields.map((field) => field.id)
    ).toEqual(['id', 'owner_id', 'title', 'active', 'created_at'])
  })

  test('requires current HR role AND record ownership for every private read and replay authority', () => {
    const app = application()
    for (const resource of app.httpApi?.resources.filter((entry) => entry.id.startsWith('hr-')) ??
      []) {
      const policies = app.auth.rowAccess.filter((policy) =>
        resource.readPolicyIds?.includes(policy.id)
      )
      expect(policies).toHaveLength(1)
      expect(policies[0].principal).toEqual({
        kind: 'related-member',
        entityFieldId: 'id',
        membershipEntityId: resource.entityId,
        membershipFieldId: 'id',
        identityFieldId: 'owner_id',
        roleId: 'recruitment-hr'
      })
    }
    for (const entry of app.commands?.commands.filter(
      (value) => !['register-business-user', 'create-hr-position'].includes(value.id)
    ) ?? []) {
      expect(entry.access).toEqual({
        kind: 'row-policy',
        entityId: 'business-hr-positions',
        parameter: 'positionId',
        policyIds: ['hr-access-hr_positions']
      })
      const reads = entry.steps.filter((step) => step.kind === 'data.read')
      expect(reads[0]).toMatchObject({
        entityId: 'business-hr-positions',
        resultName: 'position',
        lock: 'update',
        scope: 'owner'
      })
      for (const read of reads) expect(read).toMatchObject({ lock: 'update', scope: 'owner' })
    }
  })

  test('rejects mismatched candidate, employee and checklist parents under one lock order', () => {
    for (const id of ['record-hr-interview', 'offer-hr-candidate', 'start-hr-onboarding']) {
      const entry = command(id)
      expect(
        entry.steps.filter((step) => step.kind === 'data.read').map((step) => step.resultName)
      ).toEqual(['position', 'candidate'])
      expect(entry.steps).toContainEqual(
        expect.objectContaining({
          id: 'candidate_position',
          left: { kind: 'result', name: 'candidate', field: 'position_id' },
          right: { kind: 'result', name: 'position', field: 'id' }
        })
      )
    }
    const complete = command('complete-hr-checklist-item')
    expect(
      complete.steps.filter((step) => step.kind === 'data.read').map((step) => step.resultName)
    ).toEqual(['position', 'employee', 'item'])
    for (const id of [
      'employee_position',
      'item_position',
      'same_employee',
      'current_phase',
      'not_completed',
      'expected_version'
    ])
      expect(complete.steps.some((step) => step.id === id && step.kind === 'assert')).toBe(true)
    const app = application()
    for (const entity of app.dataModel.entities.filter(
      (value) => value.name.startsWith('hr_') && value.name !== 'hr_positions'
    ))
      expect(entity.foreignKeys).toContainEqual(
        expect.objectContaining({
          fields: ['position_id', 'owner_id'],
          targetEntityId: 'business-hr-positions',
          targetFields: ['id', 'owner_id']
        })
      )
  })

  test('records bounded immutable feedback without automated offers and prevents repeated conversion', () => {
    const feedback = command('record-hr-interview')
    expect(feedback.parameters).toContainEqual({
      name: 'score',
      type: 'integer',
      required: true,
      min: 1,
      max: 5
    })
    const candidateWrite = modelRequired(
      feedback.steps.find(
        (step) => step.kind === 'data.mutate' && step.entityId === 'business-hr-candidates'
      )
    )
    if (candidateWrite.kind !== 'data.mutate') throw new Error('Missing candidate mutation')
    expect(candidateWrite.values.map((value) => value.field)).not.toContain('status')
    for (const id of ['offer-hr-candidate', 'start-hr-onboarding'])
      expect(command(id).steps.some((step) => step.id === 'position_open')).toBe(true)
    expect(
      command('offer-hr-candidate').steps.some((step) => step.id === 'interview_recorded')
    ).toBe(true)
    const conversion = command('start-hr-onboarding')
    expect(conversion.steps).toContainEqual(
      expect.objectContaining({
        id: 'status_candidate',
        right: { kind: 'literal', value: 'offered' }
      })
    )
    expect(conversion.parameters.map((parameter) => parameter.name)).toEqual([
      'positionId',
      'candidateId',
      'expectedVersion',
      'note'
    ])
    const employee = modelRequired(
      application().dataModel.entities.find((entity) => entity.name === 'hr_employees')
    )
    expect(employee.uniques).toContainEqual({
      id: 'one-employee-per-candidate',
      fields: ['candidate_id']
    })
    const interviewWrites = application()
      .commands?.commands.flatMap((entry) => entry.steps)
      .filter((step) => step.kind === 'data.mutate' && step.entityId === 'business-hr-interviews')
    expect(interviewWrites).toHaveLength(1)
    expect(interviewWrites?.[0]).toMatchObject({ operation: 'insert' })
  })

  test('requires nonempty complete phase checklists and never uses onboarding counts for departure', () => {
    for (const id of ['complete-hr-onboarding', 'complete-hr-offboarding']) {
      const entry = command(id)
      expect(entry.steps).toContainEqual(
        expect.objectContaining({
          id: 'nonempty_checklist',
          operator: 'gte',
          right: { kind: 'literal', value: 1 }
        })
      )
      expect(entry.steps).toContainEqual(
        expect.objectContaining({
          id: 'all_items_completed',
          left: { kind: 'result', name: 'employee', field: 'checklist_completed' },
          right: { kind: 'result', name: 'employee', field: 'checklist_total' }
        })
      )
      expect(entry.steps.some((step) => step.id === 'expected_version')).toBe(true)
    }
    const offboarding = command('start-hr-offboarding')
    const write = modelRequired(
      offboarding.steps.find(
        (step) => step.kind === 'data.mutate' && step.entityId === 'business-hr-employees'
      )
    )
    if (write.kind !== 'data.mutate') throw new Error('Missing employee update')
    for (const field of ['checklist_total', 'checklist_completed'])
      expect(write.values).toContainEqual({ field, value: { kind: 'literal', value: 0 } })
    const add = command('add-hr-checklist-item')
    expect(add.steps).toContainEqual(
      expect.objectContaining({ id: 'bounded_checklist', right: { kind: 'literal', value: 99 } })
    )
    for (const id of ['add-hr-checklist-item', 'complete-hr-checklist-item'])
      for (const status of ['active', 'departed'])
        expect(command(id).steps.some((step) => step.id === `phase_not_${status}`)).toBe(true)
    for (const entry of application().commands?.commands ?? [])
      expect(
        entry.parameters.some((parameter) =>
          ['checklistTotal', 'checklistCompleted', 'phase', 'status', 'completedBy'].includes(
            parameter.name
          )
        )
      ).toBe(false)
  })

  test('ends every HR transaction with immutable server-actor audit and protects authority fields', () => {
    const app = application()
    for (const entry of app.commands?.commands.filter(
      (value) => value.id !== 'register-business-user'
    ) ?? [])
      expect(entry.steps.at(-1)).toMatchObject({
        kind: 'data.mutate',
        operation: 'insert',
        entityId: 'business-hr-history'
      })
    for (const write of app.commands?.commands
      .flatMap((entry) => entry.steps)
      .filter((step) => step.kind === 'data.mutate' && step.entityId === 'business-hr-history') ??
      []) {
      if (write.kind !== 'data.mutate') throw new Error('Expected audit mutation')
      expect(write.operation).toBe('insert')
      expect(write.values).toContainEqual({ field: 'actor_subject', value: { kind: 'caller-sub' } })
    }
    const candidate = modelRequired(
      app.commands?.commands.find((entry) => entry.id === 'create-hr-candidate')
    )
    const insert = modelRequired(
      candidate.steps.find(
        (step) => step.kind === 'data.mutate' && step.entityId === 'business-hr-candidates'
      )
    )
    if (insert.kind !== 'data.mutate') throw new Error('Expected candidate insertion')
    modelRequired(insert.values.find((value) => value.field === 'owner_id')).value = {
      kind: 'parameter',
      name: 'positionId'
    }
    expect(parseBackendApplicationSpecV1(app).ok).toBe(false)
  })

  test('trusted NestJS emission retains unique constraints and live role-bound private read plans', () => {
    const files = modelFiles(application())
    const sql = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(sql).toContain('UNIQUE ("candidate_id")')
    expect(sql).toContain('UNIQUE ("target_id", "after_version")')
    expect(sql).toContain('FOREIGN KEY ("employee_id", "owner_id")')
    for (const resource of [
      'hr-positions',
      'hr-candidates',
      'hr-interviews',
      'hr-employees',
      'hr-checklist',
      'hr-history'
    ]) {
      const service = modelRequired(
        files.get(`backend/nestjs/src/resources/${resource}.service.ts`)
      )
      expect(service).toContain('recruitment-hr')
      expect(service).toContain('owner_id')
    }
    expect(files.get('backend/nestjs/src/command-plans.ts')).toContain('hr-access-hr_positions')
  })
})
