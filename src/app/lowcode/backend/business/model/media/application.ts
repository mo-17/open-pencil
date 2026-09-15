import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { mediaCatalogCommands } from './catalog'
import { mediaChannelCommands } from './channels'
import { mediaFavoriteCommands } from './favorites'
import { MEDIA_ROLES } from './fields'
import { createMediaEntities } from './schema'

export function createMediaApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, MEDIA_ROLES)
  const entities = createMediaEntities(application)
  application.commands?.commands.push(
    ...mediaCatalogCommands(entities, 'video'),
    ...mediaCatalogCommands(entities, 'channel'),
    ...mediaChannelCommands(entities),
    ...mediaFavoriteCommands(entities)
  )
  return finishBusinessApplication(application)
}
