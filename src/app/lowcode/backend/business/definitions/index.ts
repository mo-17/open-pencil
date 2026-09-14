import type { BusinessTemplateId } from '../model/types'
import { bookingRegistrationDefinition } from './booking'
import { contentKnowledgeDefinition } from './content'
import { customerCRMDefinition } from './crm'
import { projectTasksDefinition } from './projects'
import { serviceDeskDefinition } from './support'

export function businessTemplateDefinition(kind: BusinessTemplateId) {
  if (kind === 'customer-crm') return customerCRMDefinition()
  if (kind === 'service-desk') return serviceDeskDefinition()
  if (kind === 'content-knowledge-base') return contentKnowledgeDefinition()
  if (kind === 'booking-registration') return bookingRegistrationDefinition()
  if (kind === 'project-tasks') return projectTasksDefinition()
  throw new Error('Business template pages have not been registered: ' + kind)
}
