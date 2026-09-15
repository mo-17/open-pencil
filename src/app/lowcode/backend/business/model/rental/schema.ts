import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { RENTAL_ADMIN_ROLE, type RentalEntities } from './fields'
import { addRentalPermissions } from './permissions'

export function createRentalEntities(application: BackendApplicationSpecV1): RentalEntities {
  const users = addBusinessUsers(application, [RENTAL_ADMIN_ROLE])
  businessEnum(application, 'rental-property-status', ['draft', 'published', 'archived'])
  businessEnum(application, 'rental-viewing-status', ['confirmed', 'cancelled', 'completed'])
  const properties = addBusinessEntity(application, 'rental_properties', [
    ...[
      'title',
      'city',
      'district',
      'address',
      'room_layout',
      'description',
      'cover_image_url',
      'panorama_url'
    ].map((id) => businessField(id, 'string')),
    businessField('rent_monthly_cents', 'integer'),
    businessField('area_sqm_x100', 'integer'),
    businessEnumField('status', 'rental-property-status', 'draft'),
    businessField('version', 'integer', 0)
  ])
  properties.indexes?.push({
    id: 'publication-city',
    fields: ['status', 'city', 'created_at', 'id'],
    order: 'desc'
  })
  const slots = addBusinessEntity(application, 'rental_slots', [
    businessField('property_id', 'uuid'),
    businessField('title', 'string'),
    businessField('starts_at', 'datetime'),
    businessField('ends_at', 'datetime'),
    businessField('capacity', 'integer'),
    businessField('reserved', 'integer', 0),
    businessField('active', 'boolean', true)
  ])
  linkBusinessOwner(slots, 'property_id', properties)
  slots.uniques?.push(
    { id: 'property-start', fields: ['property_id', 'starts_at'] },
    { id: 'slot-property-owner', fields: ['id', 'property_id', 'owner_id'] }
  )
  const viewings = addBusinessEntity(application, 'rental_viewings', [
    businessField('tenant_subject', 'uuid'),
    businessField('property_id', 'uuid'),
    businessField('slot_id', 'uuid'),
    businessField('property_title', 'string'),
    businessField('starts_at', 'datetime'),
    businessField('ends_at', 'datetime'),
    businessField('quantity', 'integer'),
    businessField('attendee_name', 'string'),
    businessField('contact', 'string'),
    businessField('note', 'string'),
    businessEnumField('status', 'rental-viewing-status', 'confirmed'),
    businessField('version', 'integer', 0)
  ])
  linkBusinessOwner(viewings, 'property_id', properties)
  viewings.foreignKeys?.push({
    id: 'slot-property-owner',
    fields: ['slot_id', 'property_id', 'owner_id'],
    targetEntityId: slots.id,
    targetFields: ['id', 'property_id', 'owner_id'],
    onDelete: 'restrict'
  })
  const propertyHistory = addBusinessEntity(application, 'rental_property_history', [
    businessField('property_id', 'uuid'),
    businessField('actor_subject', 'uuid'),
    businessField('action', 'string'),
    businessField('note', 'string')
  ])
  linkBusinessOwner(propertyHistory, 'property_id', properties)
  const viewingHistory = addBusinessEntity(application, 'rental_viewing_history', [
    businessField('viewing_id', 'uuid'),
    businessField('property_id', 'uuid'),
    businessField('actor_subject', 'uuid'),
    businessField('action', 'string'),
    businessField('note', 'string')
  ])
  linkBusinessOwner(viewingHistory, 'viewing_id', viewings)
  linkBusinessOwner(viewingHistory, 'property_id', properties)
  for (const [entity, field] of [
    [slots, 'property_id'],
    [viewings, 'property_id'],
    [propertyHistory, 'property_id'],
    [viewingHistory, 'viewing_id']
  ] as const)
    entity.indexes?.push({
      id: 'parent-created',
      fields: [field, 'created_at', 'id'],
      order: 'desc'
    })
  const entities = { users, properties, slots, viewings, propertyHistory, viewingHistory }
  addRentalPermissions(application, entities)
  return entities
}
