import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const RENTAL_LANDLORD_ROLE = 'rental-landlord'
export const RENTAL_ADMIN_ROLE = 'rental-admin'
export const RENTAL_TENANT_ROLE = 'rental-tenant'
export const RENTAL_MANAGEMENT_ROLES = [RENTAL_LANDLORD_ROLE, RENTAL_ADMIN_ROLE] as const
export const RENTAL_ROLES = [RENTAL_TENANT_ROLE, ...RENTAL_MANAGEMENT_ROLES] as const
export const RENTAL_PROPERTY_FIELDS = [
  'id',
  'title',
  'city',
  'district',
  'address',
  'rent_monthly_cents',
  'room_layout',
  'area_sqm_x100',
  'description',
  'cover_image_url',
  'panorama_url',
  'status',
  'version',
  'created_at'
]
export const RENTAL_SLOT_FIELDS = [
  'id',
  'property_id',
  'title',
  'starts_at',
  'ends_at',
  'capacity',
  'reserved',
  'active',
  'created_at'
]
export const RENTAL_VIEWING_FIELDS = [
  'id',
  'property_id',
  'slot_id',
  'property_title',
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
export const RENTAL_PROPERTY_HISTORY_FIELDS = [
  'id',
  'property_id',
  'actor_subject',
  'action',
  'note',
  'created_at'
]
export const RENTAL_VIEWING_HISTORY_FIELDS = [
  'id',
  'viewing_id',
  'property_id',
  'actor_subject',
  'action',
  'note',
  'created_at'
]

export interface RentalEntities {
  users: DataEntityIR
  properties: DataEntityIR
  slots: DataEntityIR
  viewings: DataEntityIR
  propertyHistory: DataEntityIR
  viewingHistory: DataEntityIR
}
