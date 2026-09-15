import { digestCanonicalBackendValue } from '#compiler/backend/canonical'
import type { BackendProviderDescriptor } from '#compiler/backend/contracts'

import { NESTJS_BACKEND_PROVIDER_DESCRIPTOR } from '../descriptor'

export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_PLUGIN_ID =
  'open-pencil.nestjs-prisma-crm-backend' as const
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_CONTRIBUTION_ID =
  'nestjs-prisma-crm.backend' as const
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ID = 'nestjs-prisma-crm' as const
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ADAPTER_ID =
  'open-pencil.backend.nestjs-prisma-crm' as const
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ADAPTER_VERSION = '1.0.0' as const

export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR = Object.freeze({
  ...NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  pluginId: NESTJS_PRISMA_CRM_BACKEND_PROVIDER_PLUGIN_ID,
  contributionId: NESTJS_PRISMA_CRM_BACKEND_PROVIDER_CONTRIBUTION_ID,
  providerId: NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ID,
  adapterId: NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ADAPTER_ID,
  adapterVersion: NESTJS_PRISMA_CRM_BACKEND_PROVIDER_ADAPTER_VERSION
}) satisfies BackendProviderDescriptor

export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST =
  'sha256:' +
  digestCanonicalBackendValue(
    {
      authorityDomain: 'openpencil.compiler-bundled-backend-provider.v1',
      descriptor: NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR
    },
    '$.compilerBundledNestJSPrismaCRMAuthority'
  )
