import { describe, expect, test } from 'bun:test'

import { resolveDeployEnvironment } from '@open-pencil/core/lowcode-deployment'

import { resolveDeployProvider } from '#cli/commands/deploy'

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

  test('accepts preview staging production environment labels', () => {
    expect(resolveDeployEnvironment(undefined)).toBe('preview')
    expect(resolveDeployEnvironment('preview')).toBe('preview')
    expect(resolveDeployEnvironment('staging')).toBe('staging')
    expect(resolveDeployEnvironment('production')).toBe('production')
    expect(resolveDeployEnvironment('Production')).toBe('production')
  })

  test('rejects unknown deploy environments with the supported list', () => {
    expect(() => resolveDeployEnvironment('qa')).toThrow('Supported: preview, staging, production')
  })
})
