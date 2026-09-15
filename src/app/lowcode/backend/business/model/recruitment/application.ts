import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { recruitmentCandidateCommands } from './candidates'
import { recruitmentChecklistCommands } from './checklist'
import { recruitmentEmployeeCommands } from './employees'
import { RECRUITMENT_ROLES } from './fields'
import { recruitmentPositionCommands } from './positions'
import { createRecruitmentEntities } from './schema'

export function createRecruitmentApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, RECRUITMENT_ROLES)
  const entities = createRecruitmentEntities(application)
  application.commands?.commands.push(
    ...recruitmentPositionCommands(entities),
    ...recruitmentCandidateCommands(entities),
    ...recruitmentEmployeeCommands(entities),
    ...recruitmentChecklistCommands(entities)
  )
  return finishBusinessApplication(application)
}
