import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

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
  BOOKING_FIELDS,
  BOOKING_HISTORY_FIELDS,
  BOOKING_ROLE,
  SERVICE_FIELDS,
  SLOT_FIELDS,
  type BookingEntities
} from './schema'

export function bookingAccess(
  entities: BookingEntities,
  manager = false
): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: entities.services.id,
    parameter: 'serviceId',
    policyIds: [manager ? 'manage-services' : 'public-services'],
    ...(manager ? { roleId: BOOKING_ROLE } : {})
  }
}

export function readService(entities: BookingEntities): BackendCommandStepIR {
  return businessRead(entities.services, 'service', businessParameter('serviceId'), SERVICE_FIELDS)
}

export function readSlot(
  entities: BookingEntities,
  name: string,
  key: BackendCommandLeafIR
): BackendCommandStepIR[] {
  return [
    businessRead(entities.slots, name, key, SLOT_FIELDS),
    businessAssert(
      `${name}_service`,
      businessResult(name, 'service_id'),
      businessResult('service', 'id')
    )
  ]
}

export function futureSlot(name: string): BackendCommandStepIR[] {
  return [
    businessAssert(
      `${name}_future`,
      businessResult(name, 'starts_at'),
      { kind: 'server-now' },
      'gte'
    ),
    businessAssert(`${name}_active`, businessResult(name, 'active'), businessLiteral(true))
  ]
}

export function availableSlot(
  name: string,
  quantity: BackendCommandLeafIR
): BackendCommandStepIR[] {
  return [
    businessAssert(`${name}_reserved`, businessResult(name, 'reserved'), businessLiteral(0), 'gte'),
    businessAssert(
      `${name}_capacity`,
      businessResult(name, 'capacity'),
      {
        kind: 'integer-arithmetic',
        operator: 'add',
        left: businessResult(name, 'reserved'),
        right: quantity
      },
      'gte'
    )
  ]
}

export function slotCounter(
  entities: BookingEntities,
  record: string,
  operator: 'add' | 'subtract',
  quantity: BackendCommandLeafIR
): BackendCommandStepIR {
  return businessUpdate(
    entities.slots,
    record,
    `${record}_updated`,
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
    SLOT_FIELDS
  )
}

export function readBooking(entities: BookingEntities, manager = false): BackendCommandStepIR[] {
  return [
    readService(entities),
    businessRead(
      entities.bookings,
      'booking',
      businessParameter('bookingId'),
      ['owner_id', ...BOOKING_FIELDS],
      manager ? 'command' : 'owner'
    ),
    businessAssert(
      'booking_service',
      businessResult('booking', 'service_id'),
      businessResult('service', 'id')
    ),
    businessAssert(
      'confirmed_booking',
      businessResult('booking', 'status'),
      businessLiteral('confirmed')
    )
  ]
}

export function bookingHistory(entities: BookingEntities, action: string): BackendCommandStepIR {
  return businessInsert(
    entities.history,
    'history',
    [
      { field: 'owner_id', value: businessResult('booking', 'owner_id') },
      { field: 'booking_id', value: businessResult('booking', 'id') },
      { field: 'actor_subject', value: businessCaller() },
      { field: 'action', value: businessLiteral(action) },
      { field: 'note', value: businessParameter('note') }
    ],
    BOOKING_HISTORY_FIELDS
  )
}

export function bookingRevision(): BackendCommandValueIR {
  return {
    field: 'version',
    value: {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: businessResult('booking', 'version'),
      right: businessLiteral(1)
    }
  }
}
