import { deriveBackendApplicationCapabilities } from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'

export function createBusinessBase(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1,
  roles: readonly string[]
): BackendApplicationSpecV1 {
  const application = createNestJSNotesApplication(applicationId)
  application.dataModel = { version: 1, entities: [], enums: [], relations: [] }
  application.auth.ownership = []
  application.auth.tenants = []
  application.auth.rowAccess = []
  application.auth.roles = roles.map((id) => ({ id, name: id.replaceAll('-', '_') }))
  const api = application.httpApi
  if (!api?.browserClient)
    throw new Error('Business applications require the NestJS browser client.')
  api.resources = []
  api.browserClient.authentication = structuredClone(authentication)
  application.commands = { version: 1, commands: [] }
  return application
}

export function finishBusinessApplication(
  application: BackendApplicationSpecV1
): BackendApplicationSpecV1 {
  application.capabilities = deriveBackendApplicationCapabilities(application).map(
    (capability) => ({
      capability,
      required: true
    })
  )
  return application
}
