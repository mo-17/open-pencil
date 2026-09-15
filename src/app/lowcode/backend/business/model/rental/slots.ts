import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessResult,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { businessFutureSlotWindow } from '../scheduling'
import { RENTAL_SLOT_FIELDS, type RentalEntities } from './fields'
import { publishedRentalProperty, readRentalProperty, readRentalSlot, rentalAccess } from './steps'

const capacityParameter = () => ({
  name: 'capacity',
  type: 'integer' as const,
  required: true as const,
  min: 1,
  max: 100
})

export function rentalSlotCommands(entities: RentalEntities): BackendCommandDefinitionIR[] {
  const access = () => rentalAccess(entities, 'management')
  const selection = () => [businessUUIDParameter('propertyId'), businessUUIDParameter('slotId')]
  const read = () => [
    readRentalProperty(entities),
    ...readRentalSlot(entities, 'slot', businessParameter('slotId'))
  ]
  const returns = { resultName: 'updated', fields: [...RENTAL_SLOT_FIELDS] }
  return [
    businessCommand(
      'create-rental-slot',
      'Create a viewing slot for a published property',
      access(),
      [
        businessUUIDParameter('propertyId'),
        businessStringParameter('title'),
        { name: 'startsAt', type: 'datetime', required: true },
        { name: 'endsAt', type: 'datetime', required: true },
        capacityParameter()
      ],
      [
        readRentalProperty(entities),
        publishedRentalProperty(),
        ...businessFutureSlotWindow(),
        businessInsert(
          entities.slots,
          'slot',
          [
            { field: 'owner_id', value: businessResult('property', 'owner_id') },
            { field: 'property_id', value: businessResult('property', 'id') },
            { field: 'title', value: businessParameter('title') },
            { field: 'starts_at', value: businessParameter('startsAt') },
            { field: 'ends_at', value: businessParameter('endsAt') },
            { field: 'capacity', value: businessParameter('capacity') }
          ],
          RENTAL_SLOT_FIELDS
        )
      ],
      { resultName: 'slot', fields: [...RENTAL_SLOT_FIELDS] }
    ),
    businessCommand(
      'adjust-rental-slot-capacity',
      'Adjust a viewing slot without removing held places',
      access(),
      [...selection(), capacityParameter()],
      [
        ...read(),
        businessAssert(
          'preserve_reservations',
          businessParameter('capacity'),
          businessResult('slot', 'reserved'),
          'gte'
        ),
        businessUpdate(
          entities.slots,
          'slot',
          'updated',
          [{ field: 'capacity', value: businessParameter('capacity') }],
          RENTAL_SLOT_FIELDS
        )
      ],
      returns
    ),
    businessCommand(
      'close-rental-slot',
      'Close a viewing slot to new reservations',
      access(),
      selection(),
      [
        ...read(),
        businessUpdate(
          entities.slots,
          'slot',
          'updated',
          [{ field: 'active', value: businessLiteral(false) }],
          RENTAL_SLOT_FIELDS
        )
      ],
      returns
    )
  ]
}
