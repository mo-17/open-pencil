import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

import { createApprovalsApplication } from './approvals/application'
import { createAssetsApplication } from './assets/application'
import { createAutomotiveApplication } from './automotive/application'
import { createBlogApplication } from './blog/application'
import { createBookingApplication } from './booking/application'
import { createCommunityApplication } from './community/application'
import { createContentKnowledgeApplication } from './content/application'
import { createContractsApplication } from './contracts/application'
import { createCoursesApplication } from './courses/application'
import { createCRMApplication } from './crm/application'
import { createFoodOrderingApplication } from './food-ordering/application'
import { createHospitalApplication } from './hospital/application'
import { createInventoryApplication } from './inventory/application'
import { createMediaApplication } from './media/application'
import { createProjectTaskApplication } from './projects/application'
import { createRecruitmentApplication } from './recruitment/application'
import { createRentalViewingApplication } from './rental/application'
import { createSupportApplication } from './support/application'
import { createSurveysApplication } from './surveys/application'
import { assertBusinessTemplateId, type BusinessTemplateId } from './types'

const factories = {
  'customer-crm': createCRMApplication,
  'service-desk': createSupportApplication,
  'content-knowledge-base': createContentKnowledgeApplication,
  'booking-registration': createBookingApplication,
  'project-tasks': createProjectTaskApplication,
  'rental-viewing': createRentalViewingApplication,
  'video-live': createMediaApplication,
  'food-ordering': createFoodOrderingApplication,
  'hospital-registration': createHospitalApplication,
  'personal-blog': createBlogApplication,
  'automotive-news': createAutomotiveApplication,
  'procurement-inventory': createInventoryApplication,
  'enterprise-approvals': createApprovalsApplication,
  'survey-forms': createSurveysApplication,
  'online-courses': createCoursesApplication,
  'community-forum': createCommunityApplication,
  'asset-management': createAssetsApplication,
  'quote-contracts': createContractsApplication,
  'recruitment-hr': createRecruitmentApplication
} satisfies Record<BusinessTemplateId, typeof createCRMApplication>

export function createBusinessApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1,
  kind: BusinessTemplateId
): BackendApplicationSpecV1 {
  assertBusinessTemplateId(kind)
  return factories[kind](applicationId, authentication)
}
