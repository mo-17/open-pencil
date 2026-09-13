import type {
  BackendApplicationSpecV1,
  BackendApplicationSpecV2,
  BackendHttpAPIIRV1,
  BackendHttpAPIOperation,
  BackendHttpAPIResourceIRV1
} from '@open-pencil/lowcode/backend'
import { lowerBackendApplicationSpecV1ToV2 } from '@open-pencil/lowcode/backend'

import { backendApplicationFixture } from '../fixture'

export type HTTPApplication = BackendApplicationSpecV1 & { httpApi: BackendHttpAPIIRV1 }

export function httpResource(
  id = 'notes-api',
  path = '/api/notes',
  operations: BackendHttpAPIOperation[] = ['update', 'read', 'list', 'delete', 'create']
): BackendHttpAPIResourceIRV1 {
  return {
    id,
    path,
    entityId: 'notes',
    operations,
    readFields: ['title', 'owner_id', 'id', 'body', 'created_at'],
    ...(operations.includes('create') ? { createFields: ['title', 'body'] } : {}),
    ...(operations.includes('update') ? { updateFields: ['title', 'body'] } : {}),
    ...(operations.includes('list') ? { maxPageSize: 25 } : {})
  }
}

export function httpApplication(): HTTPApplication {
  const application = backendApplicationFixture()
  application.dataModel.entities[0].fields[0].default = {
    kind: 'generated',
    generator: 'uuid'
  }
  application.dataModel.entities[0].fields.push(
    { id: 'body', name: 'body', type: 'string', nullable: true },
    {
      id: 'created_at',
      name: 'created_at',
      type: 'datetime',
      nullable: false,
      default: { kind: 'generated', generator: 'created-at' }
    }
  )
  application.capabilities.push(
    { capability: 'auth.identity', required: true },
    { capability: 'migrations.schema', required: true },
    { capability: 'server.http', required: true }
  )
  for (const name of ['JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_JWKS_URL']) {
    application.secrets.push({ kind: 'environment', name, exposure: 'server', required: true })
  }
  return {
    ...application,
    httpApi: {
      version: 1,
      authentication: {
        kind: 'jwt',
        identityId: 'user',
        issuerEnvironment: 'JWT_ISSUER',
        audienceEnvironment: 'JWT_AUDIENCE',
        jwksUrlEnvironment: 'JWT_JWKS_URL',
        algorithms: ['RS256', 'ES256']
      },
      resources: [httpResource()]
    }
  }
}

export function httpApplicationV2(): BackendApplicationSpecV2 & { httpApi: BackendHttpAPIIRV1 } {
  const lowered = lowerBackendApplicationSpecV1ToV2(httpApplication())
  if (!lowered.ok || !lowered.value.httpApi) throw new Error('HTTP fixture must lower to V2')
  return structuredClone({ ...lowered.value, httpApi: lowered.value.httpApi })
}
