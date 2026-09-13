import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { digestCanonicalBackendValue } from '../canonical'

/** Compatibility fingerprint only; never a release receipt or server authorization. */
export function nestJSPreviewApplicationDigest(value: unknown): string {
  const parsed = parseBackendApplicationSpecV1(value)
  if (!parsed.ok) throw new TypeError('A valid Backend application is required for preview.')
  return digestCanonicalBackendValue(parsed.value, '$.nestjs.preview.application')
}
