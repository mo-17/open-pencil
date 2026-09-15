import { expect, test } from 'bun:test'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createCRMApplication } from '@/app/lowcode/backend/business/model/crm/application'

import { modelFiles } from '../model-capabilities/helpers'
import { hospitalApplication, hospitalAuthentication } from './helpers'

function text(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get('backend/nestjs/' + path)
  if (typeof value !== 'string') throw new Error('Missing hospital artifact: ' + path)
  return value
}

test('hospital export uses generic locked commands and owner-bound patient foreign keys', () => {
  const files = modelFiles(hospitalApplication())
  const service = text(files, 'src/command.service.ts')
  expect(service).toContain("if (plan.access.kind === 'row-policy')")
  expect(service).toContain('const inserted =')
  expect(service.indexOf("if (plan.access.kind === 'row-policy')")).toBeLessThan(
    service.indexOf('const inserted =')
  )
  expect(text(files, 'src/command-execution.ts')).toContain(' FOR UPDATE')
  expect(text(files, 'src/command-execution.ts')).toContain('clock_timestamp()')
  const schema = text(files, 'migrations/001-initial.sql')
  expect(schema).toContain('UNIQUE ("patient_id", "slot_id")')
  expect(schema).toContain('FOREIGN KEY ("patient_id", "owner_id")')
  expect(schema).toContain('FOREIGN KEY ("appointment_id", "owner_id")')
  expect(text(files, 'src/command-plans.ts')).not.toContain('foodOrderingOperation')
  expect(files.has('backend/nestjs/src/food-execution.ts')).toBe(false)
})

test('hospital OpenAPI refuses caller-provided fee, owner and quantity and keeps owner IDs out of appointment responses', () => {
  const files = modelFiles(hospitalApplication())
  const api = JSON.parse(text(files, 'openapi.json'))
  const reserve = api.paths['/commands/reserve-hospital-appointment'].post
  const request = reserve.requestBody.content['application/json'].schema
  expect(request.additionalProperties).toBe(false)
  expect(Object.keys(request.properties).sort()).toEqual([
    'departmentId',
    'doctorId',
    'patientId',
    'slotId'
  ])
  const response = reserve.responses['200'].content['application/json'].schema
  expect(response.properties.fee_cents.type).toBe('integer')
  expect(response.properties.owner_id).toBeUndefined()
  const restore = api.paths['/commands/restore-hospital-appointment'].post
  expect(
    Object.keys(restore.requestBody.content['application/json'].schema.properties).sort()
  ).toEqual(['appointmentId', 'note', 'patientId'])
})

test('hospital and CRM compose as separate command modules sharing one account and transaction kernel', () => {
  const application = composeBusinessModules(
    createCRMApplication('hospital-crm-composition', hospitalAuthentication()),
    ['hospital-registration'],
    { adoptExisting: ['customer-crm'] }
  ).application
  const files = modelFiles(application)
  expect(files.has('backend/nestjs/src/modules/hospital-registration/commands.service.ts')).toBe(
    true
  )
  expect(files.has('backend/nestjs/src/modules/customer-crm/commands.service.ts')).toBe(true)
  expect(files.has('backend/nestjs/src/modules/shared-accounts/commands.service.ts')).toBe(true)
  expect(text(files, 'src/modules/hospital-registration/command-plans.ts')).toContain(
    'restore-hospital-appointment'
  )
  expect(text(files, 'src/modules/customer-crm/command-plans.ts')).not.toContain(
    'restore-hospital-appointment'
  )
  const schema = text(files, 'migrations/001-initial.sql')
  expect(schema).toContain('"hospital_appointments"')
  expect(schema).toContain('"customers"')
})
