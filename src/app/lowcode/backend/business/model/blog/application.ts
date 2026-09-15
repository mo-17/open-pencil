import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createPublishingApplication } from '../publishing/application'
import { BLOG_PROFILE } from './fields'

export function createBlogApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  return createPublishingApplication(applicationId, authentication, BLOG_PROFILE)
}
