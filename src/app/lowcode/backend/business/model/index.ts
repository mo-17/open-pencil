import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

import { createBookingApplication } from './booking/application'
import { createContentKnowledgeApplication } from './content/application'
import { createCRMApplication } from './crm/application'
import { createProjectTaskApplication } from './projects/application'
import { createSupportApplication } from './support/application'
import { assertBusinessTemplateId, type BusinessTemplateId } from './types'

export function createBusinessApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1,
  kind: BusinessTemplateId
): BackendApplicationSpecV1 {
  assertBusinessTemplateId(kind)
  if (kind === 'customer-crm') return createCRMApplication(applicationId, authentication)
  if (kind === 'service-desk') return createSupportApplication(applicationId, authentication)
  if (kind === 'content-knowledge-base')
    return createContentKnowledgeApplication(applicationId, authentication)
  if (kind === 'booking-registration')
    return createBookingApplication(applicationId, authentication)
  return createProjectTaskApplication(applicationId, authentication)
}
