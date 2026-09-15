import { describe, expect, test } from 'bun:test'

import { planNestJSLocalPreviewMigration } from '@open-pencil/compiler/backend'
import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import { createHospitalApplication } from '@/app/lowcode/backend/business/model/hospital/application'
import { HOSPITAL_ROLES } from '@/app/lowcode/backend/business/model/hospital/fields'

import { modelFiles } from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'hospital-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const hospital = () => createHospitalApplication('hospital-contract', authentication)
function command(app: BackendApplicationSpecV1, id: string) {
  const found = app.commands?.commands.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing hospital command: ' + id)
  return found
}
function resource(app: BackendApplicationSpecV1, id: string) {
  const found = app.httpApi?.resources.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing hospital resource: ' + id)
  return found
}
function entity(app: BackendApplicationSpecV1, name: string) {
  const found = app.dataModel.entities.find((entry) => entry.name === name)
  if (!found) throw new Error('Missing hospital entity: ' + name)
  return found
}
function policies(app: BackendApplicationSpecV1, resourceId: string) {
  return app.auth.rowAccess.filter((entry) =>
    resource(app, resourceId).readPolicyIds?.includes(entry.id)
  )
}

describe('hospital registration model', () => {
  test('fits the ordinary transaction DSL with no payments, identity documents or clinical records', () => {
    const app = hospital()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(app.dataModel.entities).toHaveLength(7)
    expect(app.commands?.commands).toHaveLength(15)
    expect(app.httpApi?.resources).toHaveLength(13)
    expect(app.auth.roles.map((entry) => entry.id)).toEqual([...HOSPITAL_ROLES])
    expect(app.commerce).toBeUndefined()
    expect(app.foodOrdering).toBeUndefined()
    for (const operation of app.commands?.commands ?? []) {
      expect(operation.commerceOperation).toBeUndefined()
      expect(operation.foodOrderingOperation).toBeUndefined()
      expect(operation.steps.length).toBeGreaterThan(0)
      expect(operation.steps.length).toBeLessThanOrEqual(32)
      expect(operation.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
    }
    expect(
      app.dataModel.entities
        .flatMap((entry) => entry.fields)
        .some((field) =>
          /diagnos|disease|identity_card|passport|payment|prescription|medical/i.test(field.id)
        )
    ).toBe(false)
    expect(
      app.httpApi?.resources.every((entry) =>
        entry.operations.every((operation) => ['list', 'read'].includes(operation))
      )
    ).toBe(true)
    expect(command(app, 'register-business-user').parameters.map((entry) => entry.name)).toEqual([
      'title'
    ])
  })

  test('keeps patient masters owner-only and exposes private appointment snapshots only to owners or hospital staff', () => {
    const app = hospital()
    for (const id of ['hospital-patients', 'hospital-appointments', 'hospital-appointment-history'])
      expect(policies(app, id).map((entry) => entry.principal.kind)).toEqual(['owner'])
    for (const id of [
      'hospital-management-appointments',
      'hospital-management-appointment-history'
    ])
      expect(policies(app, id).map((entry) => entry.principal)).toEqual(
        HOSPITAL_ROLES.map((roleId) => ({ kind: 'role', roleId }))
      )
    for (const id of ['hospital-departments', 'hospital-doctors', 'hospital-slots']) {
      expect(policies(app, id)).toMatchObject([
        { principal: { kind: 'anonymous' }, conditions: [{ fieldId: 'active', value: true }] }
      ])
      expect(
        resource(app, id).readFields.some((field) => /patient|contact|owner|actor/.test(field))
      ).toBe(false)
    }
    for (const entry of app.httpApi?.resources ?? [])
      expect(entry.readFields).not.toContain('owner_id')
    const directory = resource(app, 'hospital-patients')
    expect(directory.readPolicyIds).toEqual(['own-hospital-patients'])
    expect(resource(app, 'hospital-appointments').readFields).toContain('patient_contact')
  })

  test('has one registration per patient and slot, with complete private ownership foreign keys', () => {
    const app = hospital()
    expect(entity(app, 'hospital_appointments').uniques).toContainEqual({
      id: 'patient-slot',
      fields: ['patient_id', 'slot_id']
    })
    expect(entity(app, 'hospital_slots').uniques).toContainEqual({
      id: 'doctor-start',
      fields: ['doctor_id', 'starts_at']
    })
    expect(entity(app, 'hospital_appointments').foreignKeys).toContainEqual(
      expect.objectContaining({
        fields: ['patient_id', 'owner_id'],
        targetEntityId: 'business-hospital-patients',
        targetFields: ['id', 'owner_id'],
        onDelete: 'restrict'
      })
    )
    for (const field of ['patient_id', 'appointment_id'])
      expect(entity(app, 'hospital_appointment_history').foreignKeys).toContainEqual(
        expect.objectContaining({
          fields: [field, 'owner_id'],
          targetFields: ['id', 'owner_id'],
          onDelete: 'restrict'
        })
      )
    expect(
      entity(app, 'hospital_appointments').uniques?.some((entry) => entry.fields.includes('status'))
    ).toBe(false)
    expect(
      app.dataModel.enums.find((entry) => entry.id === 'hospital-appointment-status')?.values
    ).toEqual(['confirmed', 'cancelled', 'checked_in', 'completed'])
  })

  test('reserves one seat under ordered locks with verified references and only server-derived fees and contacts', () => {
    const app = hospital()
    const reserve = command(app, 'reserve-hospital-appointment')
    expect(reserve.parameters.map((entry) => entry.name)).toEqual([
      'patientId',
      'departmentId',
      'doctorId',
      'slotId'
    ])
    expect(reserve.access).toMatchObject({
      kind: 'row-policy',
      entityId: 'business-hospital-patients',
      parameter: 'patientId',
      policyIds: ['hospital-active-patient']
    })
    const reads = reserve.steps.filter((step) => step.kind === 'data.read')
    expect(reads.map((step) => step.resultName)).toEqual([
      'patient',
      'department',
      'doctor',
      'slot'
    ])
    expect(reads.every((step) => step.lock === 'update')).toBe(true)
    expect(reads[0]?.scope).toBe('owner')
    for (const id of [
      'doctor_department',
      'slot_department',
      'slot_doctor',
      'patient_active',
      'department_active',
      'doctor_active',
      'slot_active',
      'slot_future',
      'slot_capacity'
    ])
      expect(reserve.steps.some((step) => step.id === id && step.kind === 'assert')).toBe(true)
    const insert = reserve.steps.find(
      (step) => step.kind === 'data.mutate' && step.resultName === 'appointment'
    )
    if (insert?.kind !== 'data.mutate') throw new Error('Missing appointment insert')
    expect(insert.values).toContainEqual({
      field: 'fee_cents',
      value: { kind: 'result', name: 'slot', field: 'fee_cents' }
    })
    expect(insert.values).toContainEqual({
      field: 'patient_contact',
      value: { kind: 'result', name: 'patient', field: 'contact' }
    })
    const counter = reserve.steps.find(
      (step) => step.kind === 'data.mutate' && step.resultName === 'slot_updated'
    )
    expect(counter).toMatchObject({
      values: expect.arrayContaining([
        {
          field: 'reserved',
          value: {
            kind: 'integer-arithmetic',
            operator: 'add',
            left: { kind: 'result', name: 'slot', field: 'reserved' },
            right: { kind: 'literal', value: 1 }
          }
        }
      ])
    })
  })

  test('restores the existing record while inactive patients can still cancel and staff authority excludes owner-only grants', () => {
    const app = hospital()
    const restore = command(app, 'restore-hospital-appointment')
    expect(restore.access).toMatchObject({ policyIds: ['hospital-active-patient'] })
    expect(restore.steps).toContainEqual(
      expect.objectContaining({ kind: 'assert', right: { kind: 'literal', value: 'cancelled' } })
    )
    expect(
      restore.steps.some(
        (step) =>
          step.kind === 'data.mutate' &&
          step.operation === 'insert' &&
          step.entityId === 'business-hospital-appointments'
      )
    ).toBe(false)
    expect(restore.steps).toContainEqual(
      expect.objectContaining({
        kind: 'data.mutate',
        operation: 'update',
        entityId: 'business-hospital-appointments',
        values: expect.arrayContaining([
          { field: 'fee_cents', value: { kind: 'result', name: 'slot', field: 'fee_cents' } }
        ])
      })
    )
    const cancel = command(app, 'cancel-hospital-appointment')
    expect(cancel.access).toMatchObject({ policyIds: ['own-hospital-patients'] })
    expect(cancel.steps.some((step) => step.id === 'future_appointment')).toBe(true)
    for (const id of [
      'cancel-managed-hospital-appointment',
      'check-in-hospital-appointment',
      'complete-hospital-appointment'
    ]) {
      const operation = command(app, id)
      expect(operation.access).toMatchObject({
        entityId: 'business-hospital-patients',
        parameter: 'patientId',
        policyIds: HOSPITAL_ROLES.map((role) => 'hospital-patient-command-' + role)
      })
      expect(
        operation.steps.filter((step) => step.kind === 'data.read').map((step) => step.resultName)
      ).toEqual(['patient', 'appointment', 'department', 'doctor', 'slot'])
      expect(operation.steps.some((step) => step.id === 'appointment_patient')).toBe(true)
      expect(operation.steps.some((step) => step.id === 'appointment_owner')).toBe(true)
    }
    expect(
      command(app, 'cancel-managed-hospital-appointment').steps.some(
        (step) => step.id === 'future_appointment'
      )
    ).toBe(false)
    expect(command(app, 'check-in-hospital-appointment').steps).toContainEqual(
      expect.objectContaining({ id: 'checkin_window', operator: 'lte' })
    )
    expect(command(app, 'complete-hospital-appointment').steps).toContainEqual(
      expect.objectContaining({
        id: 'appointment_state',
        right: { kind: 'literal', value: 'checked_in' }
      })
    )
  })

  test('only administrators create schedules and later edits cannot rewrite references, fees or reserved counts', () => {
    const app = hospital()
    const create = command(app, 'create-hospital-slot')
    const update = command(app, 'update-hospital-slot')
    expect(create.access).toEqual({ kind: 'role', roleId: 'hospital-admin' })
    expect(create.parameters).toContainEqual({
      name: 'feeCents',
      type: 'integer',
      required: true,
      min: 0,
      max: 1000000
    })
    expect(create.parameters).toContainEqual({ name: 'startsAt', type: 'datetime', required: true })
    expect(update.parameters.map((entry) => entry.name)).toEqual(['slotId', 'capacity', 'active'])
    expect(update.steps.some((step) => step.id === 'preserve_reserved')).toBe(true)
    expect(
      command(app, 'update-hospital-doctor').parameters.some(
        (entry) => entry.name === 'departmentId'
      )
    ).toBe(false)
    const forged = hospital()
    const signup = command(forged, 'reserve-hospital-appointment')
    const insert = signup.steps.find(
      (step) => step.kind === 'data.mutate' && step.resultName === 'appointment'
    )
    if (insert?.kind !== 'data.mutate') throw new Error('Missing insert')
    const owner = insert.values.find((value) => value.field === 'owner_id')
    if (!owner) throw new Error('Missing owner')
    owner.value = { kind: 'parameter', name: 'patientId' }
    expect(parseBackendApplicationSpecV1(forged).ok).toBe(false)
  })

  test('emits real NestJS SQL and command plans without adding a special runtime dispatcher', () => {
    const files = modelFiles(hospital())
    const sql = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(sql).toContain('UNIQUE ("patient_id", "slot_id")')
    expect(sql).toContain('FOREIGN KEY ("patient_id", "owner_id")')
    expect(sql).toContain('"hospital_appointments"')
    expect(files.get('backend/nestjs/src/command-plans.ts')).toContain(
      'reserve-hospital-appointment'
    )
    expect(files.get('backend/nestjs/src/command.service.ts')).toContain('executeCommand')
    expect(files.has('backend/nestjs/src/hospital-execution.ts')).toBe(false)
    const patients = files.get('backend/nestjs/src/resources/hospital-patients.service.ts')
    expect(patients).toContain('owner_id')
    expect(patients).not.toContain('hospital-staff')
    expect(
      files.get('backend/nestjs/src/resources/hospital-management-appointments.service.ts')
    ).toContain('hospital-staff')
  })

  test('composes with CRM as an additive module while preserving existing account and customer authority', async () => {
    const from = createBusinessApplication('hospital-crm', authentication, 'customer-crm')
    const before = structuredClone(from)
    const to = composeBusinessModules(from, ['customer-crm', 'hospital-registration'], {
      adoptExisting: ['customer-crm']
    }).application
    expect(from).toEqual(before)
    expect(parseBackendApplicationSpecV1(to).diagnostics).toEqual([])
    for (const policy of before.auth.rowAccess)
      expect(to.auth.rowAccess.find((entry) => entry.id === policy.id)).toEqual(policy)
    for (const entry of before.httpApi?.resources ?? [])
      expect(resource(to, entry.id)).toEqual(entry)
    for (const entry of before.commands?.commands ?? [])
      expect(command(to, entry.id)).toEqual(entry)
    const module = to.modules?.modules.find((entry) => entry.id === 'hospital-registration')
    expect(module?.entityIds).toHaveLength(6)
    expect(module?.commandIds).toHaveLength(14)
    expect(module?.dependsOn).toEqual(['shared-accounts'])
    const migration = await planNestJSLocalPreviewMigration({
      fromApplication: from,
      toApplication: to
    })
    expect(migration.ok, migration.ok ? undefined : JSON.stringify(migration.diagnostics)).toBe(
      true
    )
    if (!migration.ok) throw new Error('Hospital addition was not additive')
    expect(migration.plan.sql).toContain('CREATE TABLE "public"."hospital_appointments"')
    expect(migration.plan.sql).not.toContain('ALTER TABLE "public"."customers"')
    expect(migration.plan.sql).not.toContain('ALTER TABLE "public"."users"')
  })
})
