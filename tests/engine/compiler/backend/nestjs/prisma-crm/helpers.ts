import { createBusinessApplication } from '@/app/lowcode/backend/business/model'

export function prismaCRMApplication() {
  return createBusinessApplication(
    'prisma-crm-test',
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'crm-public-client',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    },
    'customer-crm'
  )
}

export function prismaCRMCustomerResource(application: ReturnType<typeof prismaCRMApplication>) {
  const resource = application.httpApi?.resources.find((entry) => entry.id === 'customers')
  if (!resource) throw new Error('Missing CRM customer resource fixture.')
  return resource
}
