import { describe, expect, test } from 'bun:test'

import { isHarnessAuthenticationEnvironment } from '@ai-sdk/harness/utils'

import { normalizePiAuthOptions, type PiHarnessBackendOptions } from '../src/backends/pi'

describe('Pi Harness authentication compatibility', () => {
  test('normalizes the legacy gateway object to an isolated flat environment', () => {
    const options: PiHarnessBackendOptions = {
      auth: {
        gateway: {
          apiKey: 'legacy-gateway-key',
          baseUrl: 'https://gateway.example.test'
        }
      }
    }
    const normalized = normalizePiAuthOptions(options.auth, 'default-key', {})

    expect(normalized).toEqual({
      auth: {
        AI_GATEWAY_API_KEY: 'legacy-gateway-key',
        AI_GATEWAY_BASE_URL: 'https://gateway.example.test'
      },
      environment: {}
    })
    expect(() => isHarnessAuthenticationEnvironment(normalized.auth)).not.toThrow()
  })

  test('preserves legacy gateway fallback and custom environment precedence', () => {
    expect(
      normalizePiAuthOptions({ gateway: { baseUrl: 'https://gateway.example.test' } }, undefined, {
        VERCEL_OIDC_TOKEN: 'ambient-token'
      })
    ).toEqual({
      auth: {
        AI_GATEWAY_API_KEY: 'ambient-token',
        AI_GATEWAY_BASE_URL: 'https://gateway.example.test'
      },
      environment: {}
    })

    const custom = normalizePiAuthOptions(
      {
        gateway: { apiKey: 'ignored-gateway-key' },
        customEnv: {
          OPENAI_API_KEY: 'custom-openai-key',
          OPENAI_BASE_URL: 'https://openai.example.test/v1'
        }
      },
      'ignored-default-key',
      {}
    )
    expect(custom).toEqual({
      auth: {
        OPENAI_API_KEY: 'custom-openai-key',
        OPENAI_BASE_URL: 'https://openai.example.test/v1'
      },
      environment: {}
    })
    expect(() => isHarnessAuthenticationEnvironment(custom.auth)).not.toThrow()
  })

  test('keeps current modes and distinguishes explicit legacy from flat empty auth', () => {
    expect(normalizePiAuthOptions('openai', 'default-key', {})).toEqual({
      auth: 'openai',
      environment: { AI_GATEWAY_API_KEY: 'default-key' }
    })

    expect(normalizePiAuthOptions({ gateway: {} }, 'default-key', {})).toEqual({
      environment: { AI_GATEWAY_API_KEY: 'default-key' }
    })

    expect(normalizePiAuthOptions({}, 'default-key', {})).toEqual({
      auth: {},
      environment: {}
    })
  })

  test('rejects malformed legacy nested values before the upstream adapter', () => {
    expect(() =>
      normalizePiAuthOptions({ customEnv: { OPENAI_API_KEY: 42 } } as never, undefined, {})
    ).toThrow('auth.customEnv.OPENAI_API_KEY must be a string')
    expect(() =>
      normalizePiAuthOptions({ gateway: { apiKey: 42 } } as never, undefined, {})
    ).toThrow('auth.gateway.apiKey must be a string')
  })
})
