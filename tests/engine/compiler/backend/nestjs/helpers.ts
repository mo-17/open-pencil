import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { httpAPIApplication } from '../http-api/helpers'

export function nestJSApplication() {
  const application = structuredClone(httpAPIApplication())
  const key = application.dataModel.entities[0].fields[0]
  key.default = { kind: 'generated', generator: 'uuid' }
  application.secrets.push({
    kind: 'environment',
    name: 'DATABASE_URL',
    exposure: 'server',
    required: true
  })
  const parsed = parseBackendApplicationSpecV1(application)
  if (!parsed.ok) throw new Error('Expected a valid owner-only HTTP application fixture')
  return parsed.value
}
