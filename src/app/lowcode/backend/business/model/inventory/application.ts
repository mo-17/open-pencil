import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { inventoryCatalogCommands } from './catalog'
import { INVENTORY_ROLES } from './fields'
import { inventoryPurchaseCommands } from './purchases'
import { createInventoryEntities } from './schema'
import { inventoryStockCommands } from './stock'

export function createInventoryApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, INVENTORY_ROLES)
  const entities = createInventoryEntities(application)
  application.commands?.commands.push(
    ...inventoryCatalogCommands(entities),
    ...inventoryPurchaseCommands(entities),
    ...inventoryStockCommands(entities)
  )
  return finishBusinessApplication(application)
}
