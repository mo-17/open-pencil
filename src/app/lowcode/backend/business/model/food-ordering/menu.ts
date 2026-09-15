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
import { FOOD_MENU_FIELDS, FOOD_ORDERING_MANAGER_ROLE, type FoodOrderingEntities } from './fields'

const TEXT_INPUTS = [
  ['title', 'title', 200],
  ['category', 'category', 100],
  ['description', 'description', 2000],
  ['imageUrl', 'image_url', 2048]
] as const

function parameters(): BackendCommandParameterIR[] {
  return [
    ...TEXT_INPUTS.map(([name, , length]) => businessStringParameter(name, length)),
    { name: 'price', type: 'integer', required: true, min: 0, max: 1_000_000 },
    { name: 'available', type: 'boolean', required: true }
  ]
}

function values(): BackendCommandValueIR[] {
  return [
    ...TEXT_INPUTS.map(([name, field]) => ({ field, value: businessParameter(name) })),
    { field: 'price', value: businessParameter('price') },
    { field: 'available', value: businessParameter('available') }
  ]
}

export function foodMenuCommands(entities: FoodOrderingEntities): BackendCommandDefinitionIR[] {
  const access = { kind: 'role', roleId: FOOD_ORDERING_MANAGER_ROLE } as const
  return [
    businessCommand(
      'create-food-menu-item',
      'Create a menu item for this restaurant',
      access,
      [businessUUIDParameter('userId'), ...parameters()],
      [
        businessRead(
          entities.users,
          'profile',
          businessParameter('userId'),
          ['id', 'active'],
          'owner'
        ),
        businessAssert(
          'active_manager_profile',
          businessResult('profile', 'active'),
          businessLiteral(true)
        ),
        businessInsert(
          entities.menuItems,
          'item',
          [{ field: 'owner_id', value: businessCaller() }, ...values()],
          FOOD_MENU_FIELDS
        )
      ],
      { resultName: 'item', fields: [...FOOD_MENU_FIELDS] }
    ),
    businessCommand(
      'update-food-menu-item',
      'Edit this restaurant menu item and availability',
      access,
      [businessUUIDParameter('menuItemId'), ...parameters()],
      [
        businessRead(entities.menuItems, 'item', businessParameter('menuItemId'), FOOD_MENU_FIELDS),
        businessUpdate(
          entities.menuItems,
          'item',
          'updated',
          [
            ...values(),
            {
              field: 'version',
              value: {
                kind: 'integer-arithmetic',
                operator: 'add',
                left: businessResult('item', 'version'),
                right: businessLiteral(1)
              }
            }
          ],
          FOOD_MENU_FIELDS
        )
      ],
      { resultName: 'updated', fields: [...FOOD_MENU_FIELDS] }
    )
  ]
}
