import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { surveyDraftCommands } from './drafts'
import { SURVEY_ROLES } from './fields'
import { surveyResponseCommands } from './responses'
import { createSurveyEntities } from './schema'

export function createSurveysApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, SURVEY_ROLES)
  const entities = createSurveyEntities(application)
  application.commands?.commands.push(
    ...surveyDraftCommands(entities),
    ...surveyResponseCommands(entities)
  )
  return finishBusinessApplication(application)
}
