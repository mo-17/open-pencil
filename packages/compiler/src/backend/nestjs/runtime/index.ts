import type { BackendArtifactSource } from '#compiler/backend/contracts'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { emitApplicationArtifacts } from './application'
import { emitAuthenticationArtifacts } from './auth'
import { emitDatabaseArtifacts } from './database'
import { emitJWKSArtifact } from './jwks'

export function emitNestJSRuntimeArtifacts(
  application: BackendApplicationSpecV1,
  prismaCRM = false
): BackendArtifactSource[] {
  return [
    ...emitAuthenticationArtifacts(application),
    emitJWKSArtifact(),
    ...emitDatabaseArtifacts(prismaCRM),
    ...emitApplicationArtifacts(application, !prismaCRM)
  ]
}
