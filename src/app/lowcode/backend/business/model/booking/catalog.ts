import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { BOOKING_ROLE, SERVICE_FIELDS, SLOT_FIELDS, type BookingEntities } from './schema'
import { bookingAccess, readService, readSlot } from './steps'

export function bookingCatalogCommands(entities: BookingEntities): BackendCommandDefinitionIR[] {
  return [
    businessCommand(
      'create-service',
      'Create a bookable service',
      { kind: 'role', roleId: BOOKING_ROLE },
      [businessStringParameter('title'), businessStringParameter('description', 500)],
      [
        businessInsert(
          entities.services,
          'service',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'title', value: businessParameter('title') },
            { field: 'description', value: businessParameter('description') }
          ],
          SERVICE_FIELDS
        )
      ],
      { resultName: 'service', fields: [...SERVICE_FIELDS] }
    ),
    businessCommand(
      'create-slot',
      'Create a future service slot',
      bookingAccess(entities, true),
      [
        businessUUIDParameter('serviceId'),
        businessStringParameter('title'),
        { name: 'startsAt', type: 'datetime', required: true },
        { name: 'endsAt', type: 'datetime', required: true },
        { name: 'capacity', type: 'integer', required: true, min: 1, max: 100000 }
      ],
      [
        readService(entities),
        businessAssert(
          'future_start',
          businessParameter('startsAt'),
          { kind: 'server-now' },
          'gte'
        ),
        businessAssert(
          'ordered_times',
          businessParameter('endsAt'),
          businessParameter('startsAt'),
          'gte'
        ),
        businessAssert(
          'nonempty_slot',
          businessParameter('endsAt'),
          businessParameter('startsAt'),
          'neq'
        ),
        businessInsert(
          entities.slots,
          'slot',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'service_id', value: businessParameter('serviceId') },
            { field: 'title', value: businessParameter('title') },
            { field: 'starts_at', value: businessParameter('startsAt') },
            { field: 'ends_at', value: businessParameter('endsAt') },
            { field: 'capacity', value: businessParameter('capacity') }
          ],
          SLOT_FIELDS
        )
      ],
      { resultName: 'slot', fields: [...SLOT_FIELDS] }
    ),
    businessCommand(
      'adjust-slot-capacity',
      'Adjust capacity without removing reserved seats',
      bookingAccess(entities, true),
      [
        businessUUIDParameter('serviceId'),
        businessUUIDParameter('slotId'),
        { name: 'capacity', type: 'integer', required: true, min: 1, max: 100000 }
      ],
      [
        readService(entities),
        ...readSlot(entities, 'slot', businessParameter('slotId')),
        businessAssert(
          'preserve_reservations',
          businessParameter('capacity'),
          { kind: 'result', name: 'slot', field: 'reserved' },
          'gte'
        ),
        businessUpdate(
          entities.slots,
          'slot',
          'updated',
          [{ field: 'capacity', value: businessParameter('capacity') }],
          SLOT_FIELDS
        )
      ],
      { resultName: 'updated', fields: [...SLOT_FIELDS] }
    ),
    businessCommand(
      'close-slot',
      'Close a slot to new registrations',
      bookingAccess(entities, true),
      [businessUUIDParameter('serviceId'), businessUUIDParameter('slotId')],
      [
        readService(entities),
        ...readSlot(entities, 'slot', businessParameter('slotId')),
        businessUpdate(
          entities.slots,
          'slot',
          'updated',
          [{ field: 'active', value: businessLiteral(false) }],
          SLOT_FIELDS
        )
      ],
      { resultName: 'updated', fields: [...SLOT_FIELDS] }
    )
  ]
}
