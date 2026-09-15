import { assertBusinessTemplateId, type BusinessTemplateId } from '../model/types'
import type { BusinessTemplateDefinition } from '../types'
import { enterpriseApprovalsDefinition } from './approvals'
import { assetManagementDefinition } from './assets'
import { automotiveNewsDefinition } from './automotive'
import { personalBlogDefinition } from './blog'
import { bookingRegistrationDefinition } from './booking'
import { communityForumDefinition } from './community'
import { contentKnowledgeDefinition } from './content'
import { quoteContractsDefinition } from './contracts'
import { onlineCoursesDefinition } from './courses'
import { customerCRMDefinition } from './crm'
import { foodOrderingDefinition } from './food-ordering'
import { hospitalRegistrationDefinition } from './hospital'
import { procurementInventoryDefinition } from './inventory'
import { videoLiveDefinition } from './media'
import { projectTasksDefinition } from './projects'
import { recruitmentHrDefinition } from './recruitment'
import { rentalViewingDefinition } from './rental'
import { serviceDeskDefinition } from './support'
import { surveysDefinition } from './surveys'

const definitions = {
  'customer-crm': customerCRMDefinition,
  'service-desk': serviceDeskDefinition,
  'content-knowledge-base': contentKnowledgeDefinition,
  'booking-registration': bookingRegistrationDefinition,
  'project-tasks': projectTasksDefinition,
  'rental-viewing': rentalViewingDefinition,
  'video-live': videoLiveDefinition,
  'food-ordering': foodOrderingDefinition,
  'hospital-registration': hospitalRegistrationDefinition,
  'personal-blog': personalBlogDefinition,
  'automotive-news': automotiveNewsDefinition,
  'procurement-inventory': procurementInventoryDefinition,
  'enterprise-approvals': enterpriseApprovalsDefinition,
  'survey-forms': surveysDefinition,
  'online-courses': onlineCoursesDefinition,
  'community-forum': communityForumDefinition,
  'asset-management': assetManagementDefinition,
  'quote-contracts': quoteContractsDefinition,
  'recruitment-hr': recruitmentHrDefinition
} satisfies Record<BusinessTemplateId, () => BusinessTemplateDefinition>

export function businessTemplateDefinition(kind: BusinessTemplateId): BusinessTemplateDefinition {
  assertBusinessTemplateId(kind)
  return definitions[kind]()
}
