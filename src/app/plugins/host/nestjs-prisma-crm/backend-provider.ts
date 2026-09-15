import { parsePluginBackendProviderContribution } from '@open-pencil/plugin-contracts'

import { NESTJS_BACKEND_PROVIDER_CONTRIBUTION } from '../nestjs/backend-provider'

export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_PLUGIN_ID = 'open-pencil.nestjs-prisma-crm-backend'
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ID = 'nestjs-prisma-crm'
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ADAPTER_ID = 'open-pencil.backend.nestjs-prisma-crm'
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ADAPTER_VERSION = '1.0.0'

/** Exact App catalog authority, independent of the Compiler-local package digest. */
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_PACKAGE_DIGEST =
  'app-bundle-sha256:6ebQI08-NxQ5ujhj4oG4EiJy-zby4AtiIS27gkFwARI'

/** Opt-in source generation only; never authorizes preview, migrations or database access. */
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_CONTRIBUTION =
  parsePluginBackendProviderContribution({
    ...NESTJS_BACKEND_PROVIDER_CONTRIBUTION,
    providerId: NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ID,
    contributionId: 'nestjs-prisma-crm.backend',
    name: 'Nest Prisma 8 CRM Experimental',
    description:
      'Experimental CRM source export with Prisma 8 RC customer queries. Editor preview is unsupported.',
    adapterId: NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ADAPTER_ID
  })
