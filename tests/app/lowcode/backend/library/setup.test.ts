import { describe, expect, test } from 'bun:test'

import {
  templateAuthentication,
  validTemplateAuthentication
} from '@/app/lowcode/backend/library/authentication'
import { createBackendLibraryCatalog } from '@/app/lowcode/backend/library/catalog'
import {
  templateSetupProviders,
  templateSetupReadiness,
  type TemplateSetupReadinessInput
} from '@/app/lowcode/backend/library/setup/model'
import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'

function configured(): TemplateSetupReadinessInput {
  const application = createNestJSNotesApplication('setup-notes')
  const browserClient = application.httpApi?.browserClient
  if (!browserClient) throw new Error('Notes browser client is unavailable')
  browserClient.authentication = templateAuthentication(
    'oidc',
    'https://identity.example.com',
    'setup-public-client'
  )
  return {
    application,
    providerAvailable: true,
    valid: true,
    unsaved: false,
    pages: [{ id: 'notes', name: 'My notes', lowcodeRoutePattern: '/my-notes' }]
  }
}

describe('template setup', () => {
  test('offers enabled NestJS identities without treating other providers as template-compatible', () => {
    const providers = templateSetupProviders(
      createBackendLibraryCatalog(
        [
          {
            descriptorKey: 'nest-a',
            descriptor: { providerId: 'nestjs', pluginId: 'nest-a', capabilities: [] }
          },
          {
            descriptorKey: 'nest-b',
            descriptor: { providerId: 'nestjs', pluginId: 'nest-b', capabilities: [] }
          },
          {
            descriptorKey: 'supabase',
            descriptor: { providerId: 'supabase', pluginId: 'supabase', capabilities: [] }
          }
        ],
        'en'
      )
    )
    expect(providers.map((provider) => provider.descriptorKey)).toEqual(['nest-a', 'nest-b'])
    expect(templateSetupProviders(createBackendLibraryCatalog([], 'en'))).toEqual([])
  })

  test('validates public OIDC data without promoting local defaults to verified services', () => {
    const local = templateAuthentication('local-keycloak', '', '')
    expect(validTemplateAuthentication(local)).toBe(true)
    const custom = templateAuthentication(
      'oidc',
      ' https://identity.example.com/realm ',
      ' public-client '
    )
    expect(custom.issuer).toBe('https://identity.example.com/realm')
    expect(custom.clientId).toBe('public-client')
    expect(validTemplateAuthentication(custom)).toBe(true)
    expect(
      validTemplateAuthentication(
        templateAuthentication('oidc', 'http://identity.example.com', 'public-client')
      )
    ).toBe(false)
    expect(
      validTemplateAuthentication(
        templateAuthentication('oidc', 'https://identity.example.com', 'contains spaces')
      )
    ).toBe(false)
    expect(
      templateSetupReadiness(configured()).find((check) => check.id === 'runtime')?.state
    ).toBe('unverified')
  })

  test('does not treat unsaved edits, disabled providers or deleted routes as ready', () => {
    const state = configured()
    const initial = templateSetupReadiness(state)
    expect(initial.filter((check) => check.state === 'missing')).toEqual([])
    const changed = templateSetupReadiness({
      ...state,
      providerAvailable: false,
      unsaved: true,
      pages: []
    })
    expect(
      changed.filter((check) => check.state === 'missing').map((check) => [check.id, check.action])
    ).toEqual([
      ['provider', 'plugins'],
      ['model', 'model'],
      ['pages', 'pages']
    ])
    expect(changed.find((check) => check.id === 'runtime')?.state).toBe('unverified')
    expect(templateSetupReadiness(state)).toEqual(initial)
  })

  test('requires saved public login configuration and a valid model', () => {
    const blank = templateSetupReadiness({
      ...configured(),
      application: createNestJSNotesApplication('unconfigured-notes')
    })
    expect(blank.find((check) => check.id === 'login')?.state).toBe('missing')
    const state = configured()
    const application = state.application
    if (!application?.httpApi) throw new Error('Notes HTTP API is unavailable')
    delete application.httpApi.browserClient
    const result = templateSetupReadiness({ ...state, valid: false })
    expect(result.find((check) => check.id === 'login')).toEqual({
      id: 'login',
      state: 'missing',
      action: 'login'
    })
    expect(result.find((check) => check.id === 'model')?.state).toBe('missing')
    expect(
      templateSetupReadiness({ ...state, application: null }).find((check) => check.id === 'model')
        ?.state
    ).toBe('missing')
  })
})
