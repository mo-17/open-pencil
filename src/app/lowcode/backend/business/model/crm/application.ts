import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { crmCommands } from './commands'
import { createCRMEntities, CRM_MANAGER_ROLE } from './schema'

export function createCRMApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, [CRM_MANAGER_ROLE])
  const entities = createCRMEntities(application)
  application.commands?.commands.push(...crmCommands(entities))
  return finishBusinessApplication(application)
}
