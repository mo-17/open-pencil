import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { supportCommands } from './commands'
import { createSupportEntities, SUPPORT_ROLES } from './schema'

export function createSupportApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, SUPPORT_ROLES)
  const entities = createSupportEntities(application)
  application.commands?.commands.push(...supportCommands(entities))
  return finishBusinessApplication(application)
}
