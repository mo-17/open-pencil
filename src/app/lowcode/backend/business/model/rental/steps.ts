import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import { businessAuditIdentityValues } from '../audit-values'
import {
  businessAssert,
  businessCaller,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessUpdate
} from '../commands'
import {
  RENTAL_TENANT_ROLE,
  RENTAL_PROPERTY_FIELDS,
  RENTAL_PROPERTY_HISTORY_FIELDS,
  RENTAL_SLOT_FIELDS,
  RENTAL_VIEWING_FIELDS,
  RENTAL_VIEWING_HISTORY_FIELDS,
  type RentalEntities
} from './fields'
import { RENTAL_MANAGEMENT_POLICIES } from './permissions'

export function rentalAccess(
  entities: RentalEntities,
  scope: 'published' | 'management'
): BackendCommandDefinitionIR['access'] {
  const policyIds =
    scope === 'management' ? RENTAL_MANAGEMENT_POLICIES : ['rental-published-properties']
  return {
    kind: 'row-policy',
    entityId: entities.properties.id,
    parameter: 'propertyId',
    policyIds: [...policyIds],
    ...(scope === 'published' ? { roleId: RENTAL_TENANT_ROLE } : {})
  }
}

export function rentalViewingAccess(
  entities: RentalEntities,
  manager = false
): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: entities.viewings.id,
    parameter: 'viewingId',
    policyIds: manager
      ? ['rental-viewing-landlord', 'rental-viewing-admin']
      : ['own-rental-viewings']
  }
}

export function readRentalProperty(entities: RentalEntities): BackendCommandStepIR {
  return businessRead(entities.properties, 'property', businessParameter('propertyId'), [
    'owner_id',
    ...RENTAL_PROPERTY_FIELDS
  ])
}

export function publishedRentalProperty(): BackendCommandStepIR {
  return businessAssert(
    'published_property',
    businessResult('property', 'status'),
    businessLiteral('published')
  )
}

export function readRentalSlot(
  entities: RentalEntities,
  name: string,
  key: BackendCommandLeafIR
): BackendCommandStepIR[] {
  return [
    businessRead(entities.slots, name, key, RENTAL_SLOT_FIELDS),
    businessAssert(
      name + '_property',
      businessResult(name, 'property_id'),
      businessResult('property', 'id')
    )
  ]
}

export function rentalSlotCounter(
  entities: RentalEntities,
  record: string,
  operator: 'add' | 'subtract',
  quantity: BackendCommandLeafIR
): BackendCommandStepIR {
  return businessUpdate(
    entities.slots,
    record,
    record + '_updated',
    [
      {
        field: 'reserved',
        value: {
          kind: 'integer-arithmetic',
          operator,
          left: businessResult(record, 'reserved'),
          right: quantity
        }
      }
    ],
    RENTAL_SLOT_FIELDS
  )
}

export function readRentalViewing(entities: RentalEntities): BackendCommandStepIR[] {
  return [
    readRentalProperty(entities),
    businessRead(entities.viewings, 'viewing', businessParameter('viewingId'), [
      'owner_id',
      ...RENTAL_VIEWING_FIELDS
    ]),
    businessAssert(
      'viewing_property',
      businessResult('viewing', 'property_id'),
      businessResult('property', 'id')
    ),
    businessAssert(
      'confirmed_viewing',
      businessResult('viewing', 'status'),
      businessLiteral('confirmed')
    )
  ]
}

export function rentalRevision(record: string): BackendCommandValueIR {
  return {
    field: 'version',
    value: {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: businessResult(record, 'version'),
      right: businessLiteral(1)
    }
  }
}

export function rentalPropertyHistory(
  entities: RentalEntities,
  action: string,
  created = false
): BackendCommandStepIR {
  return businessInsert(
    entities.propertyHistory,
    'property_history',
    businessAuditIdentityValues('property', 'property_id', action, created),
    RENTAL_PROPERTY_HISTORY_FIELDS
  )
}

export function rentalViewingHistory(
  entities: RentalEntities,
  action: string,
  created = false
): BackendCommandStepIR {
  return businessInsert(
    entities.viewingHistory,
    'viewing_history',
    [
      {
        field: 'owner_id',
        value: created
          ? businessResult('property', 'owner_id')
          : businessResult('viewing', 'owner_id')
      },
      { field: 'viewing_id', value: businessResult('viewing', 'id') },
      {
        field: 'property_id',
        value: created ? businessResult('property', 'id') : businessResult('viewing', 'property_id')
      },
      { field: 'actor_subject', value: businessCaller() },
      { field: 'action', value: businessLiteral(action) },
      { field: 'note', value: businessParameter('note') }
    ],
    RENTAL_VIEWING_HISTORY_FIELDS
  )
}
