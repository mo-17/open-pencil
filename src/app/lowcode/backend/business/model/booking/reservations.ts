import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { BOOKING_FIELDS, type BookingEntities } from './schema'
import {
  availableSlot,
  bookingAccess,
  bookingHistory,
  bookingRevision,
  futureSlot,
  readBooking,
  readService,
  readSlot,
  slotCounter
} from './steps'

const returns = { resultName: 'updated', fields: [...BOOKING_FIELDS] }
const mutationParameters = () => [
  businessUUIDParameter('serviceId'),
  businessUUIDParameter('bookingId'),
  businessStringParameter('note', 500)
]

function reserve(entities: BookingEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'reserve-booking',
    'Reserve service capacity',
    bookingAccess(entities),
    [
      businessUUIDParameter('serviceId'),
      businessUUIDParameter('slotId'),
      businessUUIDParameter('userId'),
      { name: 'quantity', type: 'integer', required: true, min: 1, max: 99 },
      businessStringParameter('attendeeName', 100),
      businessStringParameter('contact'),
      businessStringParameter('note', 500)
    ],
    [
      readService(entities),
      businessAssert(
        'service_available',
        businessResult('service', 'active'),
        businessLiteral(true)
      ),
      businessRead(
        entities.users,
        'profile',
        businessParameter('userId'),
        ['id', 'active'],
        'owner'
      ),
      businessAssert(
        'registered_attendee',
        businessResult('profile', 'active'),
        businessLiteral(true)
      ),
      ...readSlot(entities, 'slot', businessParameter('slotId')),
      ...futureSlot('slot'),
      ...availableSlot('slot', businessParameter('quantity')),
      slotCounter(entities, 'slot', 'add', businessParameter('quantity')),
      businessInsert(
        entities.bookings,
        'booking',
        [
          { field: 'owner_id', value: businessCaller() },
          { field: 'service_id', value: businessResult('service', 'id') },
          { field: 'slot_id', value: businessResult('slot', 'id') },
          { field: 'service_title', value: businessResult('service', 'title') },
          { field: 'starts_at', value: businessResult('slot', 'starts_at') },
          { field: 'ends_at', value: businessResult('slot', 'ends_at') },
          { field: 'quantity', value: businessParameter('quantity') },
          { field: 'attendee_name', value: businessParameter('attendeeName') },
          { field: 'contact', value: businessParameter('contact') },
          { field: 'note', value: businessParameter('note') }
        ],
        BOOKING_FIELDS
      )
    ],
    { resultName: 'booking', fields: [...BOOKING_FIELDS] }
  )
}

function cancel(entities: BookingEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'cancel-booking',
    'Cancel a future booking once',
    bookingAccess(entities),
    mutationParameters(),
    [
      ...readBooking(entities),
      businessAssert(
        'future_booking',
        businessResult('booking', 'starts_at'),
        { kind: 'server-now' },
        'gte'
      ),
      ...readSlot(entities, 'slot', businessResult('booking', 'slot_id')),
      businessAssert(
        'held_capacity',
        businessResult('slot', 'reserved'),
        businessResult('booking', 'quantity'),
        'gte'
      ),
      slotCounter(entities, 'slot', 'subtract', businessResult('booking', 'quantity')),
      bookingHistory(entities, 'cancelled'),
      businessUpdate(
        entities.bookings,
        'booking',
        'updated',
        [{ field: 'status', value: businessLiteral('cancelled') }, bookingRevision()],
        BOOKING_FIELDS
      )
    ],
    returns
  )
}

function reschedule(entities: BookingEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'reschedule-booking',
    'Move a booking to another slot of the same service',
    bookingAccess(entities),
    [...mutationParameters(), businessUUIDParameter('targetSlotId')],
    [
      ...readBooking(entities),
      businessAssert(
        'service_available',
        businessResult('service', 'active'),
        businessLiteral(true)
      ),
      businessAssert(
        'future_booking',
        businessResult('booking', 'starts_at'),
        { kind: 'server-now' },
        'gte'
      ),
      businessAssert(
        'different_slot',
        businessParameter('targetSlotId'),
        businessResult('booking', 'slot_id'),
        'neq'
      ),
      ...readSlot(entities, 'previous', businessResult('booking', 'slot_id')),
      ...readSlot(entities, 'target', businessParameter('targetSlotId')),
      ...futureSlot('target'),
      ...availableSlot('target', businessResult('booking', 'quantity')),
      businessAssert(
        'held_capacity',
        businessResult('previous', 'reserved'),
        businessResult('booking', 'quantity'),
        'gte'
      ),
      slotCounter(entities, 'previous', 'subtract', businessResult('booking', 'quantity')),
      slotCounter(entities, 'target', 'add', businessResult('booking', 'quantity')),
      bookingHistory(entities, 'rescheduled'),
      businessUpdate(
        entities.bookings,
        'booking',
        'updated',
        [
          { field: 'slot_id', value: businessResult('target', 'id') },
          { field: 'starts_at', value: businessResult('target', 'starts_at') },
          { field: 'ends_at', value: businessResult('target', 'ends_at') },
          bookingRevision()
        ],
        BOOKING_FIELDS
      )
    ],
    returns
  )
}

function complete(entities: BookingEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'complete-booking',
    'Record a completed attendance after the slot starts',
    bookingAccess(entities, true),
    mutationParameters(),
    [
      ...readBooking(entities, true),
      businessAssert(
        'started_booking',
        { kind: 'server-now' },
        businessResult('booking', 'starts_at'),
        'gte'
      ),
      bookingHistory(entities, 'completed'),
      businessUpdate(
        entities.bookings,
        'booking',
        'updated',
        [{ field: 'status', value: businessLiteral('completed') }, bookingRevision()],
        BOOKING_FIELDS
      )
    ],
    returns
  )
}

export function bookingReservationCommands(
  entities: BookingEntities
): BackendCommandDefinitionIR[] {
  return [reserve(entities), cancel(entities), reschedule(entities), complete(entities)]
}
