import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { contractCompletionCommands } from './completion'
import { confirmQuoteContract } from './confirmation'
import { contractDeliveryCommands } from './deliveries'
import { CONTRACTS_ROLES } from './fields'
import { contractPartyCommands } from './parties'
import { quoteCommands } from './quotes'
import { createContractEntities } from './schema'

export function createContractsApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const app = createBusinessBase(applicationId, authentication, CONTRACTS_ROLES)
  const entities = createContractEntities(app)
  app.commands?.commands.push(
    ...contractPartyCommands(entities),
    ...quoteCommands(entities),
    confirmQuoteContract(entities),
    ...contractDeliveryCommands(entities),
    ...contractCompletionCommands(entities)
  )
  return finishBusinessApplication(app)
}
