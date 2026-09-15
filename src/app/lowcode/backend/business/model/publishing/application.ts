import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { publishingArticleCommands } from './articles'
import { publishingBookmarkCommands } from './bookmarks'
import { publishingCatalogCommands } from './catalog'
import { createPublishingEntities } from './schema'
import type { PublishingProfile } from './types'

export function createPublishingApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1,
  profile: PublishingProfile
) {
  const application = createBusinessBase(applicationId, authentication, profile.roles)
  const entities = createPublishingEntities(application, profile)
  application.commands?.commands.push(
    ...publishingCatalogCommands(profile, entities),
    ...publishingArticleCommands(profile, entities),
    ...publishingBookmarkCommands(profile, entities)
  )
  return finishBusinessApplication(application)
}
