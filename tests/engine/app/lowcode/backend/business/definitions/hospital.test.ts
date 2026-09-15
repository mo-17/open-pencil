import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { hospitalRegistrationDefinition } from '@/app/lowcode/backend/business/definitions/hospital'
import { createHospitalApplication } from '@/app/lowcode/backend/business/model/hospital/application'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'

const application = () =>
  createHospitalApplication('hospital-definition-test', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'hospital-definition-test',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
const definition = hospitalRegistrationDefinition()
const page = (id: string) => {
  const found = definition.pages.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing hospital page: ' + id)
  return found
}
const action = (id: string) => {
  const found = definition.pages
    .flatMap((entry) => entry.actions)
    .find((entry) => entry.commandId === id)
  if (!found) throw new Error('Missing hospital action: ' + id)
  return found
}

describe('hospital registration page definition', () => {
  test('separates public directories, private patient records and hospital management pages', () => {
    expect(definition.id).toBe('hospital-registration')
    expect(definition.roles).toEqual(['hospital-admin', 'hospital-staff'])
    expect(definition.entryPage).toBe('hospital-slots')
    expect(definition.pages.map((entry) => [entry.id, entry.path])).toEqual([
      ['account', '/account-setup'],
      ['hospital-departments', '/hospital/departments'],
      ['hospital-doctors', '/hospital/doctors'],
      ['hospital-slots', '/hospital/registration'],
      ['hospital-patients', '/hospital/patients'],
      ['hospital-appointments', '/hospital/appointments'],
      ['hospital-management-departments', '/hospital/admin/departments'],
      ['hospital-management-doctors', '/hospital/admin/doctors'],
      ['hospital-management-slots', '/hospital/admin/slots'],
      ['hospital-management-appointments', '/hospital/admin/appointments']
    ])
    expect(definition.pages.filter((entry) => entry.public).map((entry) => entry.id)).toEqual([
      'hospital-departments',
      'hospital-doctors',
      'hospital-slots'
    ])
    expect(page('hospital-departments').related?.[0]).toMatchObject({
      resourceId: 'hospital-doctors',
      foreignKey: 'department_id'
    })
    expect(page('hospital-doctors').related?.[0]).toMatchObject({
      resourceId: 'hospital-slots',
      foreignKey: 'doctor_id'
    })
    expect(page('hospital-appointments').related?.[0].resourceId).toBe(
      'hospital-appointment-history'
    )
    expect(page('hospital-management-appointments').related?.[0].resourceId).toBe(
      'hospital-management-appointment-history'
    )
  })

  test('preflights all 15 command forms against the actual model with no extra payment inputs', () => {
    const model = application()
    expect(() => preflightBusinessPages(model, definition)).not.toThrow()
    const actions = definition.pages.flatMap((entry) => entry.actions)
    expect(actions).toHaveLength(15)
    expect(actions.map((entry) => entry.commandId).sort()).toEqual(
      model.commands?.commands.map((entry) => entry.id).sort()
    )
    expect(action('reserve-hospital-appointment').parameters).toEqual({
      slotId: { kind: 'selection', field: 'id' },
      departmentId: { kind: 'selection', field: 'department_id' },
      doctorId: { kind: 'selection', field: 'doctor_id' },
      patientId: { kind: 'input', key: 'patientId' }
    })
    expect(action('reserve-hospital-appointment').inputs[0]).toMatchObject({
      kind: 'relation',
      relation: {
        resourceId: 'hospital-patients',
        filters: { active: { kind: 'literal', value: true } }
      }
    })
    for (const entry of actions) expect(Object.keys(entry.parameters)).not.toContain('ownerId')
    expect(Object.keys(action('reserve-hospital-appointment').parameters)).not.toContain('feeCents')
  })

  test('cascades department and doctor relations and keeps session ownership, dates and fee immutable', () => {
    const create = action('create-hospital-slot')
    expect(create.inputs.find((input) => input.key === 'departmentId')?.relation?.resourceId).toBe(
      'hospital-management-departments'
    )
    expect(create.inputs.find((input) => input.key === 'doctorId')?.relation?.filters).toEqual({
      department_id: { kind: 'input', key: 'departmentId' },
      active: { kind: 'literal', value: true }
    })
    expect(action('update-hospital-slot').inputs.map((input) => input.key)).toEqual([
      'capacity',
      'active'
    ])
    expect(action('update-hospital-doctor').inputs.map((input) => input.key)).not.toContain(
      'departmentId'
    )
    expect(create.inputs.find((input) => input.key === 'capacity')).toMatchObject({
      min: 1,
      max: 10000
    })
    expect(create.inputs.find((input) => input.key === 'feeCents')).toMatchObject({
      min: 0,
      max: 1000000
    })
  })

  test('restores the original appointment and leaves time and capacity checks to the server', () => {
    for (const [id, state] of Object.entries({
      'cancel-hospital-appointment': 'confirmed',
      'restore-hospital-appointment': 'cancelled',
      'cancel-managed-hospital-appointment': 'confirmed',
      'check-in-hospital-appointment': 'confirmed',
      'complete-hospital-appointment': 'checked_in'
    })) {
      expect(action(id).when).toEqual({ field: 'status', values: [state] })
      expect(action(id).parameters).toEqual({
        patientId: { kind: 'selection', field: 'patient_id' },
        appointmentId: { kind: 'selection', field: 'id' },
        note: { kind: 'input', key: 'note' }
      })
    }
    expect(page('hospital-appointments').description.en).toContain('reserve a different session')
    expect(action('cancel-managed-hospital-appointment').description.en).toContain(
      'already started'
    )
    expect(action('restore-hospital-appointment').description.zh).toContain('恢复原记录')
    expect(action('check-in-hospital-appointment').description.zh).toContain('不核验身份证')
  })

  test('collects only minimal patient contact data and administrative notes', () => {
    expect(action('create-hospital-patient').inputs.map((input) => input.key)).toEqual([
      'title',
      'contact',
      'relationship'
    ])
    expect(
      action('create-hospital-patient').inputs.find((input) => input.key === 'contact')?.required
    ).toBe(false)
    expect(
      action('create-hospital-patient').inputs.find((input) => input.key === 'relationship')
        ?.required
    ).toBe(false)
    expect(page('hospital-patients').description.zh).toContain('不采集身份证、诊断或病历')
    expect(page('hospital-slots').description.en).toContain('No payment is collected')
    expect(page('hospital-management-appointments').description.en).toContain('Refresh manually')
  })

  for (const locale of ['en', 'zh-CN'])
    test(`renders ${locale} eleven-page application with valid strict expressions`, () => {
      const editor = createEditor()
      const plan = prepareBusinessModulePages(editor, application(), 'hospital-registration', {
        locale
      })
      const result = editor.undo.runBatch('Hospital pages test', () =>
        renderBusinessModulePages(editor, plan)
      )
      expect(result.pageIds).toHaveLength(11)
      const nodes = [...editor.graph.getAllNodes()]
      for (const node of nodes) {
        if (node.renderCondition) expect(parseExpression(node.renderCondition).ok).toBe(true)
        const source = node.interactiveProps?.dataSourceRef
        if (source?.kind === 'backendResource') {
          for (const expression of [
            source.afterExpr,
            source.searchExpr,
            ...(source.filterEntries ?? []).map((entry) => entry.valueExpr)
          ])
            if (expression) expect(parseExpression(expression).ok).toBe(true)
        }
      }
      for (const entry of definition.pages)
        expect(
          nodes.some(
            (node) =>
              node.type === 'TEXT' && node.text === entry.title[locale === 'en' ? 'en' : 'zh']
          )
        ).toBe(true)
    })
})
