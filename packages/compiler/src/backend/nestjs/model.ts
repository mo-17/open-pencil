import type {
  AuthOwnershipIR,
  BackendApplicationSpecV1,
  BackendHttpAPIResourceIRV1,
  DataEntityIR,
  DataModelIR
} from '@open-pencil/lowcode/backend'

import { nestJSAuthorization, type NestJSAuthorization } from './authorization'

export interface NestJSResource {
  readonly resource: BackendHttpAPIResourceIRV1
  readonly entity: DataEntityIR
  readonly ownership: AuthOwnershipIR
  readonly dataModel: DataModelIR
  readonly authorization: NestJSAuthorization
}

/** Called only after the reviewed provider validator accepts the normalized application. */
export function nestJSResources(application: BackendApplicationSpecV1): NestJSResource[] {
  if (!application.httpApi) throw new Error('NestJS requires an explicit HTTP API.')
  return application.httpApi.resources.map((resource) => {
    const entity = application.dataModel.entities.find((entry) => entry.id === resource.entityId)
    const ownership = application.auth.ownership.find(
      (entry) => entry.entityId === resource.entityId
    )
    if (!entity || !ownership) throw new Error('NestJS resource references were not validated.')
    return {
      resource,
      entity,
      ownership,
      dataModel: application.dataModel,
      authorization: nestJSAuthorization(application, ownership)
    }
  })
}

export function nestJSDiagnostic(path: string, message: string) {
  return {
    code: 'backend-nestjs-unsupported',
    severity: 'error' as const,
    path,
    message
  }
}
