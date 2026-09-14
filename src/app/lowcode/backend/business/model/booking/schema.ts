import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'

export const BOOKING_ROLE = 'booking-manager'
export const SERVICE_FIELDS = ['id', 'title', 'description', 'active', 'created_at']
export const SLOT_FIELDS = [
  'id',
  'service_id',
  'title',
  'starts_at',
  'ends_at',
  'capacity',
  'reserved',
  'active',
  'created_at'
]
export const BOOKING_FIELDS = [
  'id',
  'service_id',
  'slot_id',
  'service_title',
  'starts_at',
  'ends_at',
  'quantity',
  'attendee_name',
  'contact',
  'note',
  'status',
  'version',
  'created_at'
]
export const BOOKING_HISTORY_FIELDS = [
  'id',
  'booking_id',
  'actor_subject',
  'action',
  'note',
  'created_at'
]

export interface BookingEntities {
  users: DataEntityIR
  services: DataEntityIR
  slots: DataEntityIR
  bookings: DataEntityIR
  history: DataEntityIR
}

export function createBookingEntities(application: BackendApplicationSpecV1): BookingEntities {
  const users = addBusinessUsers(application, [BOOKING_ROLE])
  businessEnum(application, 'booking-status', ['confirmed', 'cancelled', 'completed'])
  const services = addBusinessEntity(application, 'services', [
    businessField('title', 'string'),
    businessField('description', 'string'),
    businessField('active', 'boolean', true)
  ])
  const slots = addBusinessEntity(application, 'slots', [
    businessField('service_id', 'uuid'),
    businessField('title', 'string'),
    businessField('starts_at', 'datetime'),
    businessField('ends_at', 'datetime'),
    businessField('capacity', 'integer'),
    businessField('reserved', 'integer', 0),
    businessField('active', 'boolean', true)
  ])
  slots.uniques?.push({ id: 'service-start', fields: ['service_id', 'starts_at'] })
  const bookings = addBusinessEntity(application, 'bookings', [
    businessField('service_id', 'uuid'),
    businessField('slot_id', 'uuid'),
    businessField('service_title', 'string'),
    businessField('starts_at', 'datetime'),
    businessField('ends_at', 'datetime'),
    businessField('quantity', 'integer'),
    businessField('attendee_name', 'string'),
    businessField('contact', 'string'),
    businessField('note', 'string'),
    businessEnumField('status', 'booking-status', 'confirmed'),
    businessField('version', 'integer', 0)
  ])
  for (const [source, field, target] of [
    [slots, 'service_id', services],
    [bookings, 'service_id', services],
    [bookings, 'slot_id', slots]
  ] as const) {
    source.foreignKeys ??= []
    source.foreignKeys.push({
      id: field.replaceAll('_', '-'),
      fields: [field],
      targetEntityId: target.id,
      targetFields: ['id'],
      onDelete: 'restrict'
    })
  }
  const history = addBusinessEntity(application, 'booking_history', [
    businessField('booking_id', 'uuid'),
    businessField('actor_subject', 'uuid'),
    businessField('action', 'string'),
    businessField('note', 'string')
  ])
  linkBusinessOwner(history, 'booking_id', bookings)
  for (const entity of [services, slots]) {
    businessGrant(application, entity, `public-${entity.name}`, { kind: 'anonymous' })
    businessGrant(application, entity, `manage-${entity.name}`, {
      kind: 'role',
      roleId: BOOKING_ROLE
    })
  }
  for (const entity of [bookings, history]) {
    businessOwnerGrant(application, entity)
    businessGrant(application, entity, `manage-${entity.name.replaceAll('_', '-')}`, {
      kind: 'role',
      roleId: BOOKING_ROLE
    })
  }
  const serviceResource = businessReadResource(application, services, 'services', SERVICE_FIELDS, [
    'public-services'
  ])
  serviceResource.query = {
    filterFields: ['active'],
    searchFields: ['title'],
    sortFields: ['created_at']
  }
  const slotResource = businessReadResource(application, slots, 'slots', SLOT_FIELDS, [
    'public-slots'
  ])
  slotResource.query = {
    filterFields: ['service_id', 'active'],
    searchFields: ['title'],
    sortFields: ['starts_at']
  }
  const bookingResource = businessReadResource(application, bookings, 'bookings', BOOKING_FIELDS, [
    'own-bookings',
    'manage-bookings'
  ])
  bookingResource.query = {
    filterFields: ['service_id', 'slot_id', 'status'],
    searchFields: ['service_title'],
    sortFields: ['starts_at']
  }
  const eventResource = businessReadResource(
    application,
    history,
    'booking-history',
    BOOKING_HISTORY_FIELDS,
    ['own-booking-history', 'manage-booking-history']
  )
  eventResource.query = {
    filterFields: ['booking_id'],
    searchFields: [],
    sortFields: ['created_at']
  }
  return { users, services, slots, bookings, history }
}
