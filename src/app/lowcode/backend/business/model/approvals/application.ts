import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { APPROVALS_ROLES } from './fields'
import { approvalRequestCommands } from './requests'
import { createApprovalEntities } from './schema'
import { approvalTransitionCommands } from './transitions'

export function createApprovalsApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, APPROVALS_ROLES)
  const entities = createApprovalEntities(application)
  application.commands?.commands.push(
    ...approvalRequestCommands(entities),
    ...approvalTransitionCommands(entities)
  )
  return finishBusinessApplication(application)
}
