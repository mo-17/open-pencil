import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { assetCatalogCommands, assetLifecycleCommands } from './catalog'
import { ASSET_ROLES } from './fields'
import { assetIssueCommands, assetReturnCommand } from './fulfillment'
import { assetRequestCommands, assetWithdrawCommands } from './requests'
import { createAssetEntities } from './schema'

export function createAssetsApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, ASSET_ROLES)
  const entities = createAssetEntities(application)
  application.commands?.commands.push(
    ...assetCatalogCommands(entities),
    ...assetRequestCommands(entities),
    ...assetWithdrawCommands(entities),
    ...assetIssueCommands(entities),
    assetReturnCommand(entities),
    ...assetLifecycleCommands(entities)
  )
  return finishBusinessApplication(application)
}
