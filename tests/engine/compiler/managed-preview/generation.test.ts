import { describe, expect, test } from 'bun:test'

import { compileManagedGeneration } from '#compiler/managed-preview/generation'

import { browserApplication } from '../backend/nestjs/browser-client/helpers'

describe('managed preview source applicability', () => {
  test('generates a normal browser application with the fixed managed worker and initial schema', () => {
    const files = compileManagedGeneration(browserApplication())
    expect(files.has('src/main.ts')).toBe(true)
    expect(files.has('scripts/managed/worker.mjs')).toBe(true)
    expect(files.get('migrations/001-initial.sql')).toContain('CREATE TABLE "public"."notes"')
    expect(files.get('scripts/local-config.mjs')).toContain(
      "export const LOCAL = resolve(ROOT, '../..', '.local')"
    )
  })

  test('rejects a reserved compatibility namespace before generating installable artifacts', () => {
    const application = browserApplication()
    if (!application.httpApi) throw new Error('Missing HTTP API')
    application.httpApi.resources[0].path = '/_openpencil/preview-contract'
    expect(() => compileManagedGeneration(application)).toThrow(
      'does not support this managed preview application'
    )
  })

  test('rejects missing or unsupported connected browser authentication', () => {
    const application = browserApplication()
    if (!application.httpApi?.browserClient) throw new Error('Missing browser authentication')
    Object.assign(application.httpApi.browserClient.authentication, { kind: 'password' })
    expect(() => compileManagedGeneration(application)).toThrow()
    const missing = browserApplication()
    if (!missing.httpApi) throw new Error('Missing HTTP API')
    delete missing.httpApi.browserClient
    expect(() => compileManagedGeneration(missing)).toThrow(
      'does not support this managed preview application'
    )
  })
})
