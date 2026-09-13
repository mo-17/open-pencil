/** Portable host configuration; no URL, credential or execution command is accepted. */
export interface PreviewLocalBackendConnection {
  readonly previewPort: number
  readonly apiPort: number
  readonly apiBasePath: string
  readonly applicationId: string
  readonly applicationDigest: string
}

const KEYS = ['apiBasePath', 'apiPort', 'applicationDigest', 'applicationId', 'previewPort']

function invalid(): Error {
  return new Error(
    'NestJS preview connection must contain only valid loopback ports, an API path, application ID and digest.'
  )
}

function connectionFields(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw invalid()
  if (
    Reflect.ownKeys(value).length !== KEYS.length ||
    Object.keys(value).sort().join(',') !== KEYS.join(',')
  )
    throw invalid()
  const fields: Record<string, unknown> = {}
  for (const key of KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) throw invalid()
    fields[key] = descriptor.value
  }
  return fields
}

export function parsePreviewLocalBackendConnection(value: unknown): PreviewLocalBackendConnection {
  const { previewPort, apiPort, apiBasePath, applicationId, applicationDigest } =
    connectionFields(value)
  const port = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535
  if (
    !port(previewPort) ||
    !port(apiPort) ||
    previewPort === apiPort ||
    typeof apiBasePath !== 'string' ||
    apiBasePath.length > 128 ||
    !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(apiBasePath) ||
    apiBasePath.startsWith('/_openpencil') ||
    typeof applicationId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(applicationId) ||
    typeof applicationDigest !== 'string' ||
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(applicationDigest)
  )
    throw invalid()
  return Object.freeze({ previewPort, apiPort, apiBasePath, applicationId, applicationDigest })
}
