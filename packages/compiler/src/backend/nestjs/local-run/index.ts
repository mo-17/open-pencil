import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSArtifact, nestJSJSONArtifact } from '../artifact'
import { CONFIGURATION_SOURCE } from './configuration'
import { DATABASE_SOURCE } from './database'
import { DOCTOR_SOURCE } from './doctor'
import { LIFECYCLE_SOURCE, WEB_SOURCE } from './lifecycle'
import { MANAGED_DATABASE_SOURCE } from './managed/database'
import { MANAGED_WORKER_SOURCE } from './managed/worker'

export const NESTJS_LOCAL_SCRIPTS = {
  'local:configure': 'node scripts/local.mjs configure',
  'local:setup': 'node scripts/local.mjs setup',
  'local:up': 'node scripts/local.mjs up',
  'local:down': 'node scripts/local.mjs down',
  'local:doctor': 'node scripts/local.mjs doctor'
} as const

export function emitNestJSLocalRun(application: BackendApplicationSpecV1) {
  return [
    nestJSJSONArtifact(
      'local-project.json',
      {
        version: 1,
        applicationId: application.applicationId,
        authentication: application.httpApi?.authentication,
        browserClient: application.httpApi?.browserClient ?? null,
        resources: application.httpApi?.resources.map(({ path }) => path) ?? []
      },
      'server-runtime'
    ),
    ...Object.entries({
      'local.mjs': LIFECYCLE_SOURCE,
      'local-config.mjs': CONFIGURATION_SOURCE,
      'local-database.mjs': DATABASE_SOURCE,
      'local-doctor.mjs': DOCTOR_SOURCE,
      'local-web.mjs': WEB_SOURCE,
      'managed/database.mjs': MANAGED_DATABASE_SOURCE,
      'managed/worker.mjs': MANAGED_WORKER_SOURCE
    }).map(([path, source]) => nestJSArtifact('scripts/' + path, source))
  ]
}
