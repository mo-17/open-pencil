export const BUSINESS_TEMPLATE_IDS = [
  'customer-crm',
  'service-desk',
  'content-knowledge-base',
  'booking-registration',
  'project-tasks'
] as const

export type BusinessTemplateId = (typeof BUSINESS_TEMPLATE_IDS)[number]

export function assertBusinessTemplateId(value: string): asserts value is BusinessTemplateId {
  if (!BUSINESS_TEMPLATE_IDS.some((entry) => entry === value))
    throw new TypeError('Unknown business application template.')
}
