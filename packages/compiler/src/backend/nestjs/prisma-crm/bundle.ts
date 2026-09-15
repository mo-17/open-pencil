import { digestCanonicalBackendValue } from '#compiler/backend/canonical'
import type {
  BackendProviderAdapter,
  BackendProviderAdapterContext,
  BackendProviderBundle
} from '#compiler/backend/contracts'

import { emitNestJSServer, NESTJS_BACKEND_PROVIDER_BUNDLE } from '../bundle'
import { validateNestJSBackendProvider } from '../validation'
import { NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR } from './descriptor'
import { validatePrismaCRMApplication } from './profile'

const server: BackendProviderAdapter = {
  ...NESTJS_BACKEND_PROVIDER_BUNDLE.server,
  plan: (context) => ({
    format: 'openpencil.nestjs-prisma-crm-plan.v1',
    version: 1,
    applicationDigest: digestCanonicalBackendValue(context.application, '$.nestjs.application'),
    preset: 'nestjs11-postgresql16-prisma8-crm-experimental-v1'
  }),
  emit: ({ application }) => emitNestJSServer(application, true)
}

/** Reviewed source export only; a distinct identity cannot enter the pg preview registry. */
export const NESTJS_PRISMA_CRM_BACKEND_PROVIDER_BUNDLE = Object.freeze({
  ...NESTJS_BACKEND_PROVIDER_BUNDLE,
  descriptor: NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR,
  server,
  validate: (context: BackendProviderAdapterContext) => {
    const diagnostics = validateNestJSBackendProvider(context)
    return diagnostics.length ? diagnostics : validatePrismaCRMApplication(context.application)
  }
}) satisfies BackendProviderBundle
