import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { RENTAL_ROLES } from './fields'
import { rentalPropertyCommands } from './properties'
import { createRentalEntities } from './schema'
import { rentalSlotCommands } from './slots'
import { rentalViewingCommands } from './viewings'

export function createRentalViewingApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, RENTAL_ROLES)
  const entities = createRentalEntities(application)
  application.commands?.commands.push(
    ...rentalPropertyCommands(entities),
    ...rentalSlotCommands(entities),
    ...rentalViewingCommands(entities)
  )
  return finishBusinessApplication(application)
}
