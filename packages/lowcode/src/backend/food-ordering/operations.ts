import {
  requiredUUIDParameter,
  requiredTextParameter,
  requiredIntegerParameter
} from '../commands/parameters'
import type { BackendCommandDefinitionIR, BackendCommandParameterIR } from '../commands/types'
import type { BackendApplicationSpecV1 } from '../types'
import { foodOrderingResultFields } from './schema'
import {
  FOOD_ORDERING_OPERATIONS,
  type BackendFoodOrderingEntitiesIR,
  type BackendFoodOrderingIRV1,
  type BackendFoodOrderingOperation
} from './types'

export function foodOrderingOperationEntityKey(
  operation: BackendFoodOrderingOperation
): keyof BackendFoodOrderingEntitiesIR {
  return operation.startsWith('cart.') ? 'carts' : 'orders'
}

function parameters(operation: BackendFoodOrderingOperation): BackendCommandParameterIR[] {
  let fields: BackendCommandParameterIR[]
  if (operation === 'cart.set')
    fields = [requiredUUIDParameter('menuItemId'), requiredIntegerParameter('quantity', 1, 99)]
  else if (operation === 'cart.remove') fields = [requiredUUIDParameter('itemId')]
  else if (operation.startsWith('checkout.'))
    fields = [
      requiredIntegerParameter('cartRevision', 0, 2147483647),
      requiredTextParameter('contactName', 100),
      requiredTextParameter('phone', 64),
      requiredTextParameter('note', 500),
      ...(operation === 'checkout.dine-in' ? [requiredTextParameter('tableNumber', 32)] : [])
    ]
  else fields = [requiredUUIDParameter('orderId'), requiredTextParameter('note', 500)]
  return fields.sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

export function foodOrderingCommandDefinition(
  profile: BackendFoodOrderingIRV1,
  operation: BackendFoodOrderingOperation
): BackendCommandDefinitionIR {
  const manager = operation.startsWith('order.') && operation !== 'order.cancel'
  return {
    id: 'food.' + operation,
    name: 'food.' + operation,
    path: '/commands/food-' + operation.replace('.', '-'),
    access: manager ? { kind: 'role', roleId: profile.managerRoleId } : { kind: 'authenticated' },
    idempotency: { kind: 'required', header: 'Idempotency-Key' },
    parameters: parameters(operation),
    foodOrderingOperation: operation,
    steps: [],
    return: {
      resultName: 'result',
      fields: foodOrderingResultFields(foodOrderingOperationEntityKey(operation)).sort((a, b) =>
        a.localeCompare(b, 'en')
      )
    }
  }
}

export function foodOrderingCommandDefinitions(
  application: Pick<BackendApplicationSpecV1, 'foodOrdering'>
): BackendCommandDefinitionIR[] {
  const profile = application.foodOrdering
  return profile
    ? FOOD_ORDERING_OPERATIONS.map((operation) => foodOrderingCommandDefinition(profile, operation))
    : []
}
