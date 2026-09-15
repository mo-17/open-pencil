import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'
import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'

// Keep successful composition fixtures within the public 20,000-node IR budget.
// Separate groups cover every template; oversized combinations are tested explicitly.
export const ESTABLISHED_BUSINESS_KINDS = [
  'customer-crm',
  'service-desk',
  'content-knowledge-base',
  'booking-registration',
  'project-tasks',
  'rental-viewing',
  'video-live',
  'food-ordering'
] as const satisfies readonly BusinessTemplateId[]

export const BOUNDED_BUSINESS_GROUPS = [
  { name: 'established templates', kinds: ESTABLISHED_BUSINESS_KINDS, entities: 31, commands: 84 },
  {
    name: 'CRM, restaurant and hospital',
    kinds: ['customer-crm', 'food-ordering', 'hospital-registration'],
    entities: 15,
    commands: 36
  },
  {
    name: 'CRM, blog and automotive news',
    kinds: ['customer-crm', 'personal-blog', 'automotive-news'],
    entities: 13,
    commands: 32
  },
  {
    name: 'CRM, inventory and enterprise approvals',
    kinds: ['customer-crm', 'procurement-inventory', 'enterprise-approvals'],
    entities: 12,
    commands: 37
  },
  {
    name: 'CRM, surveys, courses and community',
    kinds: ['customer-crm', 'survey-forms', 'online-courses', 'community-forum'],
    entities: 14,
    commands: 39
  },
  {
    name: 'CRM, assets, contracts and recruitment',
    kinds: ['customer-crm', 'asset-management', 'quote-contracts', 'recruitment-hr'],
    entities: 18,
    commands: 45
  }
] as const satisfies readonly {
  name: string
  kinds: readonly BusinessTemplateId[]
  entities: number
  commands: number
}[]

export const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'business-public-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}

export function business(kind: BusinessTemplateId = 'customer-crm') {
  return createBusinessApplication('existing-business-app', authentication, kind)
}

export function resource(application: BackendApplicationSpecV1, id: string) {
  const value = application.httpApi?.resources.find((entry) => entry.id === id)
  if (!value) throw new Error('Missing fixture resource: ' + id)
  return value
}

export function notes() {
  const base = createNestJSNotesApplication('unrelated-existing-app')
  const client = base.httpApi?.browserClient
  if (!client) throw new Error('Missing fixture browser client')
  client.authentication = structuredClone(authentication)
  return base
}
