import { digestCanonicalBackendValue } from '../canonical'
import type {
  BackendProviderAdapter,
  BackendProviderAdapterContext,
  BackendProviderBundle
} from '../contracts'
import { emitNestJSClient } from './client'
import { emitNestJSCommands } from './commands'
import { emitNestJSController } from './controller'
import { NESTJS_BACKEND_PROVIDER_DESCRIPTOR } from './descriptor'
import { emitNestJSDTO } from './dto'
import { nestJSResources } from './model'
import { emitNestJSModules } from './modules'
import { emitNestJSOpenAPI } from './openapi'
import { emitPrismaCRMContract } from './prisma-crm/contract'
import { emitPrismaCRMRuntime } from './prisma-crm/runtime'
import { emitPrismaCRMService } from './prisma-crm/service'
import { emitNestJSProject } from './project'
import { emitNestJSListQuery } from './query'
import { emitNestJSRequestValidation } from './request-validation'
import { emitNestJSRuntimeArtifacts } from './runtime'
import { emitNestJSSchema } from './schema'
import { emitNestJSService } from './service'
import { validateNestJSBackendProvider } from './validation'

function plan(context: BackendProviderAdapterContext) {
  return {
    format: 'openpencil.nestjs-owner-crud-plan.v1',
    version: 1,
    preset: 'nestjs11-postgresql16-owner-v1',
    applicationDigest: digestCanonicalBackendValue(context.application, '$.nestjs.application')
  }
}

const data: BackendProviderAdapter = {
  capabilities: ['data.read', 'data.write'],
  outputs: ['client-config', 'database-schema'],
  plan,
  emit: ({ application }) => [
    emitNestJSClient(application),
    ...emitNestJSSchema(application).filter((artifact) => artifact.kind === 'database-schema')
  ]
}
const auth: BackendProviderAdapter = {
  capabilities: ['auth.identity', 'auth.roles'],
  outputs: [],
  plan,
  emit: () => []
}
const migrations: BackendProviderAdapter = {
  capabilities: ['migrations.schema'],
  outputs: ['migration-plan'],
  plan,
  emit: ({ application }) =>
    emitNestJSSchema(application).filter((artifact) => artifact.kind === 'migration-plan')
}
const securityPolicy: BackendProviderAdapter = {
  capabilities: ['policy.row-level'],
  outputs: ['security-policy'],
  plan,
  emit: ({ application }) =>
    emitNestJSSchema(application).filter((artifact) => artifact.kind === 'security-policy')
}
const server: BackendProviderAdapter = {
  capabilities: ['server.http', 'server.functions', 'transactions.atomic'],
  outputs: ['server-runtime'],
  plan,
  emit: ({ application }) => emitNestJSServer(application)
}

export function emitNestJSServer(
  application: BackendProviderAdapterContext['application'],
  prismaCRM = false
) {
  return [
    ...emitNestJSProject(application, prismaCRM),
    emitNestJSOpenAPI(application),
    emitNestJSRequestValidation(),
    emitNestJSListQuery(),
    ...emitNestJSRuntimeArtifacts(application, prismaCRM),
    ...(prismaCRM ? [emitPrismaCRMContract(application), ...emitPrismaCRMRuntime()] : []),
    ...emitNestJSCommands(application),
    ...emitNestJSModules(application),
    ...nestJSResources(application).flatMap((model, index) => [
      ...emitNestJSController(model, index),
      ...emitNestJSDTO(model, index),
      prismaCRM && model.resource.id === 'customers'
        ? emitPrismaCRMService(index)
        : emitNestJSService(model, index)
    ])
  ]
}

/** Static, pure adapter. No environment, network, database, or execution authority enters it. */
export const NESTJS_BACKEND_PROVIDER_BUNDLE = Object.freeze({
  descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  data,
  auth,
  migrations,
  securityPolicy,
  server,
  validate: validateNestJSBackendProvider
}) satisfies BackendProviderBundle
