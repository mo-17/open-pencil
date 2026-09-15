import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

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
import { RENTAL_PROPERTY_FIELDS, type RentalEntities } from './fields'
import { RENTAL_CREATE_POLICIES } from './permissions'
import { readRentalProperty, rentalAccess, rentalPropertyHistory, rentalRevision } from './steps'

const PROPERTY_INPUTS = [
  ['title', 'title', 200],
  ['city', 'city', 100],
  ['district', 'district', 100],
  ['address', 'address', 300],
  ['roomLayout', 'room_layout', 100],
  ['description', 'description', 2000],
  ['coverImageUrl', 'cover_image_url', 2048],
  ['panoramaUrl', 'panorama_url', 2048]
] as const

function propertyParameters(): BackendCommandParameterIR[] {
  return [
    ...PROPERTY_INPUTS.map(([name, , maximum]) => businessStringParameter(name, maximum)),
    { name: 'rentMonthlyCents', type: 'integer', required: true, min: 1, max: 100000000 },
    { name: 'areaSqmX100', type: 'integer', required: true, min: 1, max: 10000000 }
  ]
}
function propertyValues(): BackendCommandValueIR[] {
  return [
    ...PROPERTY_INPUTS.map(([name, field]) => ({ field, value: businessParameter(name) })),
    { field: 'rent_monthly_cents', value: businessParameter('rentMonthlyCents') },
    { field: 'area_sqm_x100', value: businessParameter('areaSqmX100') }
  ]
}

export function rentalPropertyCommands(entities: RentalEntities): BackendCommandDefinitionIR[] {
  const returns = { resultName: 'updated', fields: [...RENTAL_PROPERTY_FIELDS] }
  const create = businessCommand(
    'create-rental-property',
    'Create my rental property draft',
    {
      kind: 'row-policy',
      entityId: entities.users.id,
      parameter: 'userId',
      policyIds: [...RENTAL_CREATE_POLICIES]
    },
    [businessUUIDParameter('userId'), ...propertyParameters()],
    [
      businessRead(
        entities.users,
        'profile',
        businessParameter('userId'),
        ['id', 'active'],
        'owner'
      ),
      businessAssert(
        'registered_landlord',
        businessResult('profile', 'active'),
        businessLiteral(true)
      ),
      businessInsert(
        entities.properties,
        'property',
        [{ field: 'owner_id', value: businessCaller() }, ...propertyValues()],
        ['owner_id', ...RENTAL_PROPERTY_FIELDS]
      ),
      rentalPropertyHistory(entities, 'created', true)
    ],
    { resultName: 'property', fields: [...RENTAL_PROPERTY_FIELDS] }
  )
  const update = businessCommand(
    'update-rental-property',
    'Edit a property I manage',
    rentalAccess(entities, 'management'),
    [
      businessUUIDParameter('propertyId'),
      ...propertyParameters(),
      businessStringParameter('note', 500)
    ],
    [
      readRentalProperty(entities),
      rentalPropertyHistory(entities, 'edited'),
      businessUpdate(
        entities.properties,
        'property',
        'updated',
        [...propertyValues(), rentalRevision('property')],
        RENTAL_PROPERTY_FIELDS
      )
    ],
    returns
  )
  const transitions = [
    ['publish-rental-property', 'Publish a rental property', 'published'],
    ['archive-rental-property', 'Take a rental property off the market', 'archived']
  ] as const
  return [
    create,
    update,
    ...transitions.map(([id, name, status]) =>
      businessCommand(
        id,
        name,
        rentalAccess(entities, 'management'),
        [businessUUIDParameter('propertyId'), businessStringParameter('note', 500)],
        [
          readRentalProperty(entities),
          businessAssert(
            'different_property_status',
            businessResult('property', 'status'),
            businessLiteral(status),
            'neq'
          ),
          rentalPropertyHistory(entities, status),
          businessUpdate(
            entities.properties,
            'property',
            'updated',
            [{ field: 'status', value: businessLiteral(status) }, rentalRevision('property')],
            RENTAL_PROPERTY_FIELDS
          )
        ],
        returns
      )
    )
  ]
}
