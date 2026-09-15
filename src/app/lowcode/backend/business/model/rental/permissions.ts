import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { businessGrant, businessReadResource } from '../permissions'
import {
  RENTAL_ADMIN_ROLE,
  RENTAL_LANDLORD_ROLE,
  RENTAL_PROPERTY_FIELDS,
  RENTAL_PROPERTY_HISTORY_FIELDS,
  RENTAL_MANAGEMENT_ROLES,
  RENTAL_SLOT_FIELDS,
  RENTAL_VIEWING_FIELDS,
  RENTAL_VIEWING_HISTORY_FIELDS,
  type RentalEntities
} from './fields'

export const RENTAL_MANAGEMENT_POLICIES = ['rental-property-landlord', 'rental-property-admin']
export const RENTAL_CREATE_POLICIES = RENTAL_MANAGEMENT_ROLES.map((role) => role + '-own-profile')

/** A landlord role is never sufficient: each managed row must belong to the caller's property. */
function managementPolicies(
  application: BackendApplicationSpecV1,
  entities: RentalEntities,
  entity: DataEntityIR,
  prefix: string,
  propertyField = 'property_id'
): string[] {
  return [
    businessGrant(application, entity, prefix + '-landlord', {
      kind: 'related-member',
      entityFieldId: propertyField,
      membershipEntityId: entities.properties.id,
      membershipFieldId: 'id',
      identityFieldId: 'owner_id',
      roleId: RENTAL_LANDLORD_ROLE
    }),
    businessGrant(application, entity, prefix + '-admin', {
      kind: 'role',
      roleId: RENTAL_ADMIN_ROLE
    })
  ]
}

function publicationPolicy(application: BackendApplicationSpecV1, entity: DataEntityIR): string {
  const id = 'rental-published-properties'
  application.auth.rowAccess.push({
    id,
    entityId: entity.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'anonymous' },
    conditions: [{ fieldId: 'status', value: 'published' }]
  })
  return id
}

export function addRentalPermissions(
  application: BackendApplicationSpecV1,
  entities: RentalEntities
): void {
  const { properties, slots, viewings, propertyHistory, viewingHistory, users } = entities
  for (const roleId of RENTAL_MANAGEMENT_ROLES) {
    application.auth.rowAccess.push({
      id: roleId + '-own-profile',
      entityId: users.id,
      effect: 'allow',
      operations: ['select'],
      // Only the create command selects these policies; its locked profile read
      // separately requires the caller's ownership and an active profile.
      principal: { kind: 'role', roleId },
      conditions: [{ fieldId: 'active', value: true }]
    })
  }
  const published = publicationPolicy(application, properties)
  const management = managementPolicies(application, entities, properties, 'rental-property', 'id')
  for (const [id, policies] of [
    ['rental-properties', [published]],
    ['rental-management-properties', management]
  ] as const) {
    const resource = businessReadResource(
      application,
      properties,
      id,
      RENTAL_PROPERTY_FIELDS,
      policies
    )
    resource.query = {
      filterFields: ['city', 'district', 'room_layout', 'status'],
      searchFields: ['title', 'city', 'district'],
      sortFields: ['created_at', 'rent_monthly_cents']
    }
  }
  // Times contain no tenant identity or contact. Publication is rechecked under lock when reserving.
  application.auth.rowAccess.push({
    id: 'rental-open-slots',
    entityId: slots.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'authenticated' },
    conditions: [{ fieldId: 'active', value: true }]
  })
  const slotManagement = managementPolicies(application, entities, slots, 'rental-slot')
  for (const [id, policies] of [
    ['rental-slots', ['rental-open-slots']],
    ['rental-management-slots', slotManagement]
  ] as const) {
    const resource = businessReadResource(application, slots, id, RENTAL_SLOT_FIELDS, policies)
    resource.query = {
      filterFields: ['property_id', 'active'],
      searchFields: ['title'],
      sortFields: ['starts_at']
    }
  }
  const viewingPolicies = [
    businessGrant(application, viewings, 'own-rental-viewings', {
      kind: 'related-member',
      entityFieldId: 'id',
      membershipEntityId: viewings.id,
      membershipFieldId: 'id',
      identityFieldId: 'tenant_subject'
    }),
    ...managementPolicies(application, entities, viewings, 'rental-viewing')
  ]
  const reservations = businessReadResource(
    application,
    viewings,
    'rental-viewings',
    RENTAL_VIEWING_FIELDS,
    viewingPolicies
  )
  reservations.query = {
    filterFields: ['property_id', 'slot_id', 'status'],
    searchFields: ['property_title'],
    sortFields: ['starts_at']
  }
  const propertyEvents = businessReadResource(
    application,
    propertyHistory,
    'rental-property-history',
    RENTAL_PROPERTY_HISTORY_FIELDS,
    managementPolicies(application, entities, propertyHistory, 'rental-property-history')
  )
  propertyEvents.query = {
    filterFields: ['property_id'],
    searchFields: [],
    sortFields: ['created_at']
  }
  const viewingEvents = businessReadResource(
    application,
    viewingHistory,
    'rental-viewing-history',
    RENTAL_VIEWING_HISTORY_FIELDS,
    [
      businessGrant(application, viewingHistory, 'own-rental-viewing-history', {
        kind: 'related-member',
        entityFieldId: 'viewing_id',
        membershipEntityId: viewings.id,
        membershipFieldId: 'id',
        identityFieldId: 'tenant_subject'
      }),
      ...managementPolicies(application, entities, viewingHistory, 'rental-viewing-history')
    ]
  )
  viewingEvents.query = {
    filterFields: ['viewing_id', 'property_id'],
    searchFields: [],
    sortFields: ['created_at']
  }
}
