import {
  foodOrderingCommandDefinitions,
  type BackendApplicationSpecV1,
  type BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import {
  FOOD_ORDERING_MANAGER_ROLE,
  FOOD_ORDERING_ROLES,
  foodOrderingEntityReferences
} from './fields'
import { foodMenuCommands } from './menu'
import { addFoodOrderingPermissions } from './permissions'
import { createFoodOrderingEntities } from './schema'

export function createFoodOrderingApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
): BackendApplicationSpecV1 {
  const application = createBusinessBase(applicationId, authentication, FOOD_ORDERING_ROLES)
  const entities = createFoodOrderingEntities(application)
  addFoodOrderingPermissions(application, entities)
  application.foodOrdering = {
    version: 1,
    currency: 'CNY',
    maxItems: 50,
    maxQuantity: 99,
    managerRoleId: FOOD_ORDERING_MANAGER_ROLE,
    entities: foodOrderingEntityReferences(entities)
  }
  application.commands?.commands.push(
    ...foodMenuCommands(entities),
    ...foodOrderingCommandDefinitions(application)
  )
  return finishBusinessApplication(application)
}
