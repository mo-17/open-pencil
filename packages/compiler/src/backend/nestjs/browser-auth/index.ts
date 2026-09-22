import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { browserAuthenticationFlow } from './flow'
import { NETWORK_SOURCE } from './network'
import { PREVIEW_RELAY_SOURCE } from './preview-relay'
import { STATE_SOURCE } from './state'

export const OPENID_CLIENT_VERSION = '6.8.8'

/** Pure source generation; identity-provider discovery happens only after an explicit login. */
export function emitBrowserAuthentication(
  application: BackendApplicationSpecV1,
  options: { previewRelay?: boolean } = {}
): string {
  const config = application.httpApi?.browserClient
  if (!config) throw new Error('Browser authentication requires a reviewed browser client.')
  const binding = JSON.stringify({ applicationId: application.applicationId, ...config })
  return (
    "import * as oidc from 'openid-client'\n\n" +
    'const CONFIG: { version: 1; apiBasePath: string; authentication: { kind: string; issuer: string; clientId: string; scopes: string[]; callbackPath: string; resource?: string } } = ' +
    JSON.stringify(config) +
    '\nconst BINDING = ' +
    JSON.stringify(binding) +
    '\nconst STORAGE_KEY = ' +
    JSON.stringify('openpencil:oidc:v1:' + application.applicationId) +
    '\nconst TRANSACTION_AGE = 600000\n' +
    STATE_SOURCE +
    NETWORK_SOURCE +
    (options.previewRelay ? PREVIEW_RELAY_SOURCE : '') +
    browserAuthenticationFlow(options.previewRelay === true)
  )
}
