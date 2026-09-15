export const BUSINESS_TEMPLATE_IDS = [
  'customer-crm',
  'service-desk',
  'content-knowledge-base',
  'booking-registration',
  'project-tasks',
  'rental-viewing',
  'video-live',
  'food-ordering',
  'hospital-registration',
  'personal-blog',
  'automotive-news',
  'procurement-inventory',
  'enterprise-approvals',
  'survey-forms',
  'online-courses',
  'community-forum',
  'asset-management',
  'quote-contracts',
  'recruitment-hr'
] as const

export type BusinessTemplateId = (typeof BUSINESS_TEMPLATE_IDS)[number]

export function assertBusinessTemplateId(value: string): asserts value is BusinessTemplateId {
  if (!BUSINESS_TEMPLATE_IDS.some((entry) => entry === value))
    throw new TypeError('Unknown business application template.')
}
