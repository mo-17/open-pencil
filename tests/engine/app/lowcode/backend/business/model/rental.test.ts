import { describe, expect, test } from 'bun:test'

import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  createBuiltinBackendProviderRegistry,
  createBackendProviderPlan,
  emitBackendProviderPlan
} from '@open-pencil/compiler/backend'
import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { businessTemplateDefinition } from '@/app/lowcode/backend/business/definitions'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'rental-public-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const rental = () => createBusinessApplication('rental-contract', authentication, 'rental-viewing')
function command(app: BackendApplicationSpecV1, id: string) {
  const value = app.commands?.commands.find((entry) => entry.id === id)
  if (!value) throw new Error('Missing rental command: ' + id)
  return value
}
function resource(app: BackendApplicationSpecV1, id: string) {
  const value = app.httpApi?.resources.find((entry) => entry.id === id)
  if (!value) throw new Error('Missing rental resource: ' + id)
  return value
}
function policies(app: BackendApplicationSpecV1, id: string) {
  const projection = resource(app, id)
  return app.auth.rowAccess.filter((entry) => projection.readPolicyIds?.includes(entry.id))
}
function assertion(app: BackendApplicationSpecV1, id: string, stepId: string) {
  const value = command(app, id).steps.find((entry) => entry.id === stepId)
  if (value?.kind !== 'assert') throw new Error('Missing rental assertion: ' + stepId)
  return value
}

describe('rental viewing application contracts', () => {
  test('trusted NestJS pg export includes every rental resource, command and owner-bound foreign key', () => {
    const registry = createBuiltinBackendProviderRegistry()
    const selection = {
      descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: 'sha256:' + 'A'.repeat(43),
      enabled: true
    }
    const planned = createBackendProviderPlan(registry, {
      application: rental(),
      selection,
      target: 'vue',
      mode: 'production'
    })
    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    if (!planned.ok) throw new Error('Rental plan failed')
    const emitted = emitBackendProviderPlan(registry, { selection, plan: planned.plan })
    expect(emitted.ok).toBe(true)
    if (!emitted.ok) throw new Error('Rental emission failed')
    const files = emitted.emission.files
    const schema = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(schema).toContain('"rental_properties"')
    expect(schema).toContain('"tenant_subject" uuid NOT NULL')
    expect(schema).toContain('FOREIGN KEY ("slot_id", "property_id", "owner_id")')
    expect(files.get('backend/nestjs/src/command-plans.ts')).toContain('reserve-rental-viewing')
    expect(files.get('backend/nestjs/src/resources/rental-properties.service.ts')).toContain(
      'published'
    )
    expect(files.get('backend/nestjs/src/resources/rental-viewings.service.ts')).toContain(
      'tenant_subject'
    )
    expect(files.get('backend/nestjs/package.json')).toContain('"pg"')
    expect(files.get('backend/nestjs/package.json')).not.toContain('@prisma')
  })

  test('normalizes six managed entities and thirteen ordinary idempotent commands with no CRUD bypass', () => {
    const app = rental()
    expect(parseBackendApplicationSpecV1(app).diagnostics).toEqual([])
    expect(app.dataModel.entities).toHaveLength(6)
    expect(app.commands?.commands).toHaveLength(13)
    expect(app.httpApi?.resources).toHaveLength(9)
    expect(app.commerce).toBeUndefined()
    for (const entry of app.commands?.commands ?? []) {
      expect(entry.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
      expect(entry.steps.length).toBeLessThanOrEqual(32)
      expect(
        entry.parameters.some((parameter) =>
          [
            'owner_id',
            'ownerId',
            'tenant_subject',
            'tenantSubject',
            'status',
            'reserved',
            'version'
          ].includes(parameter.name)
        )
      ).toBe(false)
    }
    for (const entry of app.httpApi?.resources ?? []) {
      expect(entry.operations).toEqual(['list', 'read'])
      expect(entry.readFields).not.toContain('owner_id')
      expect(entry.readFields).not.toContain('tenant_subject')
    }
  })

  test('public properties always filter publication and selectable slots require authentication without tenant details', () => {
    const app = rental()
    expect(policies(app, 'rental-properties')).toMatchObject([
      { principal: { kind: 'anonymous' }, conditions: [{ fieldId: 'status', value: 'published' }] }
    ])
    expect(policies(app, 'rental-slots')).toMatchObject([
      { principal: { kind: 'authenticated' }, conditions: [{ fieldId: 'active', value: true }] }
    ])
    for (const id of ['rental-properties', 'rental-slots']) {
      expect(resource(app, id).readFields).not.toContain('contact')
      expect(resource(app, id).readFields).not.toContain('attendee_name')
    }
    expect(resource(app, 'rental-properties').readFields).toContain('panorama_url')
  })

  test('landlord management requires property ownership plus role and tenant access uses an immutable verified subject', () => {
    const app = rental()
    for (const id of [
      'rental-management-properties',
      'rental-management-slots',
      'rental-viewings',
      'rental-property-history',
      'rental-viewing-history'
    ]) {
      const grants = policies(app, id)
      expect(grants.find((entry) => entry.id.endsWith('-landlord'))?.principal).toMatchObject({
        kind: 'related-member',
        membershipEntityId: 'business-rental-properties',
        identityFieldId: 'owner_id',
        roleId: 'rental-landlord'
      })
      expect(
        grants.filter((entry) => entry.principal.kind === 'role').map((entry) => entry.principal)
      ).toEqual([{ kind: 'role', roleId: 'rental-admin' }])
    }
    expect(
      policies(app, 'rental-viewings').find((entry) => entry.id === 'own-rental-viewings')
        ?.principal
    ).toMatchObject({
      kind: 'related-member',
      entityFieldId: 'id',
      membershipEntityId: 'business-rental-viewings',
      identityFieldId: 'tenant_subject'
    })
    const inserted = command(app, 'reserve-rental-viewing').steps.find(
      (entry) => entry.kind === 'data.mutate' && entry.entityId === 'business-rental-viewings'
    )
    if (inserted?.kind !== 'data.mutate') throw new Error('Missing viewing insert')
    expect(inserted.values.find((value) => value.field === 'tenant_subject')?.value).toEqual({
      kind: 'caller-sub'
    })
    expect(inserted.values.find((value) => value.field === 'owner_id')?.value).toEqual({
      kind: 'result',
      name: 'property',
      field: 'owner_id'
    })
    expect(command(app, 'reserve-rental-viewing').access).toMatchObject({ roleId: 'rental-tenant' })
    expect(command(app, 'create-rental-property').access).toMatchObject({
      policyIds: ['rental-landlord-own-profile', 'rental-admin-own-profile']
    })
    const create = command(app, 'create-rental-property')
    expect(create.steps[0]).toMatchObject({
      kind: 'data.read',
      entityId: 'business-users',
      scope: 'owner',
      lock: 'update'
    })
    expect(create.steps[1]).toMatchObject({
      kind: 'assert',
      left: { kind: 'result', name: 'profile', field: 'active' },
      operator: 'eq',
      right: { kind: 'literal', value: true }
    })
    for (const roleId of ['rental-landlord', 'rental-admin']) {
      expect(
        app.auth.rowAccess.find((policy) => policy.id === roleId + '-own-profile')?.principal
      ).toEqual({ kind: 'role', roleId })
      expect(
        app.httpApi?.resources.some((entry) =>
          entry.readPolicyIds?.includes(roleId + '-own-profile')
        )
      ).toBe(false)
    }
    expect(command(app, 'cancel-rental-viewing').access).toMatchObject({
      kind: 'row-policy',
      entityId: 'business-rental-viewings',
      parameter: 'viewingId',
      policyIds: ['own-rental-viewings']
    })
    expect(command(app, 'cancel-managed-rental-viewing').access).toMatchObject({
      policyIds: ['rental-viewing-landlord', 'rental-viewing-admin']
    })
  })

  test('reserve, cancel and reschedule hold the property lock and validate both foreign slots before writing', () => {
    const app = rental()
    for (const id of [
      'reserve-rental-viewing',
      'cancel-rental-viewing',
      'cancel-managed-rental-viewing',
      'reschedule-rental-viewing',
      'complete-rental-viewing'
    ]) {
      expect(command(app, id).steps[0]).toMatchObject({
        kind: 'data.read',
        entityId: 'business-rental-properties',
        lock: 'update',
        key: { kind: 'parameter', name: 'propertyId' }
      })
    }
    for (const id of ['reserve-rental-viewing', 'reschedule-rental-viewing']) {
      expect(assertion(app, id, 'published_property').right).toEqual({
        kind: 'literal',
        value: 'published'
      })
    }
    const reschedule = command(app, 'reschedule-rental-viewing')
    const writeIndex = reschedule.steps.findIndex((entry) => entry.kind === 'data.mutate')
    for (const id of [
      'viewing_property',
      'previous_property',
      'target_property',
      'target_future',
      'target_active',
      'target_capacity',
      'held_capacity'
    ]) {
      const index = reschedule.steps.findIndex((entry) => entry.id === id)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(writeIndex)
    }
    expect(assertion(app, 'cancel-rental-viewing', 'confirmed_viewing').right).toEqual({
      kind: 'literal',
      value: 'confirmed'
    })
    expect(assertion(app, 'adjust-rental-slot-capacity', 'preserve_reservations').operator).toBe(
      'gte'
    )
    expect(assertion(app, 'complete-rental-viewing', 'started_viewing').left).toEqual({
      kind: 'server-now'
    })
  })

  test('defines linked audit trails and VR detail pages and composes without changing existing CRM or booking ownership', () => {
    const app = rental()
    const definition = businessTemplateDefinition('rental-viewing')
    expect(definition.entryPage).toBe('rental-properties')
    expect(
      definition.pages.filter((page) => page.vrTourField).map((page) => [page.id, page.vrTourField])
    ).toEqual([
      ['rental-properties', 'panorama_url'],
      ['rental-management-properties', 'panorama_url']
    ])
    const combined = composeBusinessModules(
      app,
      ['rental-viewing', 'customer-crm', 'booking-registration'],
      { adoptExisting: ['rental-viewing'] }
    ).application
    expect(parseBackendApplicationSpecV1(combined).diagnostics).toEqual([])
    expect(combined.dataModel.entities.filter((entry) => entry.name === 'users')).toHaveLength(1)
    const module = combined.modules?.modules.find((entry) => entry.id === 'rental-viewing')
    expect(module?.entityIds).toHaveLength(5)
    expect(module?.commandIds).toHaveLength(12)
    expect(module?.dependsOn).toEqual(['shared-accounts'])
    for (const entity of app.dataModel.entities.filter((entry) =>
      entry.name.startsWith('rental_')
    )) {
      expect(combined.dataModel.entities.find((entry) => entry.id === entity.id)).toEqual(entity)
    }
  })
})
