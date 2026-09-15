import * as v from 'valibot'

import { diagnostic, id, uniqueBy, type BackendValidationContext } from '../validation-helpers'
import { FOOD_ORDERING_ENTITY_KEYS, type BackendFoodOrderingIRV1 } from './types'

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(128))
const profileSchema = v.strictObject({
  version: v.literal(1),
  currency: v.literal('CNY'),
  maxItems: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)),
  maxQuantity: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(99)),
  managerRoleId: identifier,
  entities: v.strictObject({
    menuItems: identifier,
    carts: identifier,
    cartItems: identifier,
    orders: identifier,
    orderItems: identifier,
    orderHistory: identifier
  })
})

export function foodOrderingError(
  context: BackendValidationContext,
  path: string,
  message: string
): void {
  diagnostic(context, 'backend-food-ordering-invalid', path, message)
}

export function parseBackendFoodOrderingIRV1(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendFoodOrderingIRV1 | undefined {
  const result = v.safeParse(profileSchema, value)
  if (!result.success) {
    foodOrderingError(
      context,
      path,
      'Food ordering requires the exact bounded single-restaurant contract.'
    )
    return undefined
  }
  for (const key of FOOD_ORDERING_ENTITY_KEYS)
    id(result.output.entities[key], path + '.entities.' + key, context)
  id(result.output.managerRoleId, path + '.managerRoleId', context)
  uniqueBy(
    Object.values(result.output.entities),
    path + '.entities',
    context,
    'food ordering entity'
  )
  return result.output
}
