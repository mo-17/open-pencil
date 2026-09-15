import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { COMMUNITY_ROLES } from './fields'
import { communityFollowCommands, communityReportCommands } from './participation'
import { communityPostCommands } from './posts'
import { communityReplyCommands } from './replies'
import { createCommunityEntities } from './schema'

export function createCommunityApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, COMMUNITY_ROLES)
  const entities = createCommunityEntities(application)
  application.commands?.commands.push(
    ...communityPostCommands(entities),
    ...communityReplyCommands(entities),
    ...communityFollowCommands(entities),
    ...communityReportCommands(entities)
  )
  return finishBusinessApplication(application)
}
