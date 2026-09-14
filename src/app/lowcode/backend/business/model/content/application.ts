import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { addContentCommands } from './commands'
import { addContentSchema, CONTENT_ROLES } from './schema'

export function createContentKnowledgeApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
): BackendApplicationSpecV1 {
  const application = createBusinessBase(applicationId, authentication, CONTENT_ROLES)
  const model = addContentSchema(application)
  addContentCommands(application, model)
  return finishBusinessApplication(application)
}
