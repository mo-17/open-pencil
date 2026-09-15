import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createPublishingApplication } from '../publishing/application'
import { AUTOMOTIVE_PROFILE } from './fields'

export function createAutomotiveApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  return createPublishingApplication(applicationId, authentication, AUTOMOTIVE_PROFILE)
}
