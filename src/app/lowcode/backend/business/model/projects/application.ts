import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { projectMemberCommands } from './members'
import { createProjectEntities, PROJECT_ROLE } from './schema'
import { projectTaskCommands } from './tasks'

export function createProjectTaskApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, [PROJECT_ROLE])
  const entities = createProjectEntities(application)
  application.commands?.commands.push(
    ...projectMemberCommands(entities),
    ...projectTaskCommands(entities)
  )
  return finishBusinessApplication(application)
}
