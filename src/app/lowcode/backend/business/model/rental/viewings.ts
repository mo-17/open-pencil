import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import { availableSlot, futureSlot } from '../booking/steps'
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
import { RENTAL_VIEWING_FIELDS, type RentalEntities } from './fields'
import {
  publishedRentalProperty,
  readRentalProperty,
  readRentalSlot,
  readRentalViewing,
  rentalAccess,
  rentalRevision,
  rentalSlotCounter,
  rentalViewingHistory,
  rentalViewingAccess
} from './steps'

const mutationParameters = () => [
  businessUUIDParameter('propertyId'),
  businessUUIDParameter('viewingId'),
  businessStringParameter('note', 500)
]
const returns = { resultName: 'updated', fields: [...RENTAL_VIEWING_FIELDS] }

function reserve(entities: RentalEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'reserve-rental-viewing',
    'Reserve places for a future property viewing',
    rentalAccess(entities, 'published'),
    [
      businessUUIDParameter('propertyId'),
      businessUUIDParameter('slotId'),
      businessUUIDParameter('userId'),
      { name: 'quantity', type: 'integer', required: true, min: 1, max: 20 },
      businessStringParameter('attendeeName', 100),
      businessStringParameter('contact', 200),
      businessStringParameter('note', 500)
    ],
    [
      readRentalProperty(entities),
      publishedRentalProperty(),
      businessRead(
        entities.users,
        'profile',
        businessParameter('userId'),
        ['id', 'active'],
        'owner'
      ),
      businessAssert(
        'registered_viewer',
        businessResult('profile', 'active'),
        businessLiteral(true)
      ),
      ...readRentalSlot(entities, 'slot', businessParameter('slotId')),
      ...futureSlot('slot'),
      ...availableSlot('slot', businessParameter('quantity')),
      rentalSlotCounter(entities, 'slot', 'add', businessParameter('quantity')),
      businessInsert(
        entities.viewings,
        'viewing',
        [
          { field: 'owner_id', value: businessResult('property', 'owner_id') },
          { field: 'tenant_subject', value: businessCaller() },
          { field: 'property_id', value: businessResult('property', 'id') },
          { field: 'slot_id', value: businessResult('slot', 'id') },
          { field: 'property_title', value: businessResult('property', 'title') },
          { field: 'starts_at', value: businessResult('slot', 'starts_at') },
          { field: 'ends_at', value: businessResult('slot', 'ends_at') },
          { field: 'quantity', value: businessParameter('quantity') },
          { field: 'attendee_name', value: businessParameter('attendeeName') },
          { field: 'contact', value: businessParameter('contact') },
          { field: 'note', value: businessParameter('note') }
        ],
        ['owner_id', ...RENTAL_VIEWING_FIELDS]
      ),
      rentalViewingHistory(entities, 'reserved', true)
    ],
    { resultName: 'viewing', fields: [...RENTAL_VIEWING_FIELDS] }
  )
}

function cancel(entities: RentalEntities, manager: boolean): BackendCommandDefinitionIR {
  return businessCommand(
    manager ? 'cancel-managed-rental-viewing' : 'cancel-rental-viewing',
    manager ? 'Cancel a viewing for a property I manage' : 'Cancel my future viewing once',
    rentalViewingAccess(entities, manager),
    mutationParameters(),
    [
      ...readRentalViewing(entities),
      businessAssert(
        'future_viewing',
        businessResult('viewing', 'starts_at'),
        { kind: 'server-now' },
        'gte'
      ),
      ...readRentalSlot(entities, 'slot', businessResult('viewing', 'slot_id')),
      businessAssert(
        'held_capacity',
        businessResult('slot', 'reserved'),
        businessResult('viewing', 'quantity'),
        'gte'
      ),
      rentalSlotCounter(entities, 'slot', 'subtract', businessResult('viewing', 'quantity')),
      rentalViewingHistory(entities, manager ? 'cancelled_by_manager' : 'cancelled'),
      businessUpdate(
        entities.viewings,
        'viewing',
        'updated',
        [{ field: 'status', value: businessLiteral('cancelled') }, rentalRevision('viewing')],
        RENTAL_VIEWING_FIELDS
      )
    ],
    returns
  )
}

function reschedule(entities: RentalEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'reschedule-rental-viewing',
    'Move my viewing within the same published property',
    rentalViewingAccess(entities),
    [...mutationParameters(), businessUUIDParameter('targetSlotId')],
    [
      ...readRentalViewing(entities),
      publishedRentalProperty(),
      businessAssert(
        'future_viewing',
        businessResult('viewing', 'starts_at'),
        { kind: 'server-now' },
        'gte'
      ),
      businessAssert(
        'different_slot',
        businessParameter('targetSlotId'),
        businessResult('viewing', 'slot_id'),
        'neq'
      ),
      ...readRentalSlot(entities, 'previous', businessResult('viewing', 'slot_id')),
      ...readRentalSlot(entities, 'target', businessParameter('targetSlotId')),
      ...futureSlot('target'),
      ...availableSlot('target', businessResult('viewing', 'quantity')),
      businessAssert(
        'held_capacity',
        businessResult('previous', 'reserved'),
        businessResult('viewing', 'quantity'),
        'gte'
      ),
      rentalSlotCounter(entities, 'previous', 'subtract', businessResult('viewing', 'quantity')),
      rentalSlotCounter(entities, 'target', 'add', businessResult('viewing', 'quantity')),
      rentalViewingHistory(entities, 'rescheduled'),
      businessUpdate(
        entities.viewings,
        'viewing',
        'updated',
        [
          { field: 'slot_id', value: businessResult('target', 'id') },
          { field: 'starts_at', value: businessResult('target', 'starts_at') },
          { field: 'ends_at', value: businessResult('target', 'ends_at') },
          rentalRevision('viewing')
        ],
        RENTAL_VIEWING_FIELDS
      )
    ],
    returns
  )
}

function complete(entities: RentalEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'complete-rental-viewing',
    'Complete a confirmed viewing after its start',
    rentalViewingAccess(entities, true),
    mutationParameters(),
    [
      ...readRentalViewing(entities),
      businessAssert(
        'started_viewing',
        { kind: 'server-now' },
        businessResult('viewing', 'starts_at'),
        'gte'
      ),
      rentalViewingHistory(entities, 'completed'),
      businessUpdate(
        entities.viewings,
        'viewing',
        'updated',
        [{ field: 'status', value: businessLiteral('completed') }, rentalRevision('viewing')],
        RENTAL_VIEWING_FIELDS
      )
    ],
    returns
  )
}

export function rentalViewingCommands(entities: RentalEntities): BackendCommandDefinitionIR[] {
  return [
    reserve(entities),
    cancel(entities, false),
    cancel(entities, true),
    reschedule(entities),
    complete(entities)
  ]
}
