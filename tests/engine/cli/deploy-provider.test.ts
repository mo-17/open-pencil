import { describe, expect, test } from 'bun:test'

import { resolveDeployProvider } from '../../../packages/cli/src/commands/deploy'

describe('deploy CLI provider parsing', () => {
  test('accepts all deploy providers exposed by help text', () => {
    expect(resolveDeployProvider(undefined)).toBe('netlify')
    expect(resolveDeployProvider('netlify')).toBe('netlify')
    expect(resolveDeployProvider('vercel')).toBe('vercel')
    expect(resolveDeployProvider('cloudflare')).toBe('cloudflare')
    expect(resolveDeployProvider('Cloudflare')).toBe('cloudflare')
  })

  test('rejects unknown deploy providers with the supported list', () => {
    expect(() => resolveDeployProvider('github-pages')).toThrow(
      'Supported: netlify, vercel, cloudflare'
    )
  })
})
