import { BACKEND_OIDC_CALLBACK_PATH } from '@open-pencil/lowcode/backend'
import type { BackendHttpAPIBrowserClientIRV1 } from '@open-pencil/lowcode/backend'

import { commandApplication } from '../commands/fixture'
import { httpApplication } from './fixtures'

export function browserClient(): BackendHttpAPIBrowserClientIRV1 {
  return {
    version: 1,
    apiBasePath: '/api',
    authentication: {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.test/tenant',
      clientId: 'public-browser-app',
      scopes: ['profile', 'openid'],
      callbackPath: BACKEND_OIDC_CALLBACK_PATH
    }
  }
}

export function browserApplication() {
  const application = httpApplication()
  application.httpApi.browserClient = browserClient()
  const title = application.dataModel.entities[0].fields.find((field) => field.id === 'title')
  if (!title) throw new Error('Expected title field')
  title.nullable = false
  return application
}

export function commandBrowserApplication() {
  const application = commandApplication()
  application.httpApi.browserClient = browserClient()
  return application
}
