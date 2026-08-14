import { describe, expect, test } from 'bun:test'

import { resolveMicrofrontendPackaging } from '#cli/microfrontend-args'

describe('microfrontend CLI packaging flags', () => {
  test('keeps standalone packaging implicit by default', () => {
    expect(resolveMicrofrontendPackaging({})).toBeUndefined()
    expect(resolveMicrofrontendPackaging({ packaging: 'standalone' })).toBeUndefined()
  })

  test('resolves an explicit microfrontend identity', () => {
    expect(
      resolveMicrofrontendPackaging({
        packaging: 'microfrontend',
        'app-id': 'acme.orders',
        'app-version': '1.2.3'
      })
    ).toEqual({ kind: 'microfrontend', appId: 'acme.orders', version: '1.2.3' })
  })

  test('rejects incomplete or ambiguous combinations', () => {
    expect(() => resolveMicrofrontendPackaging({ 'app-id': 'acme.orders' })).toThrow(
      'require --packaging microfrontend'
    )
    expect(() => resolveMicrofrontendPackaging({ packaging: 'microfrontend' })).toThrow(
      '--app-id is required'
    )
    expect(() => resolveMicrofrontendPackaging({ packaging: 'federation' })).toThrow(
      'Unknown --packaging'
    )
  })
})
