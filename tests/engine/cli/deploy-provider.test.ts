import { describe, expect, test } from 'bun:test'

import { resolveDeployEnvironment } from '@open-pencil/core/lowcode-deployment'

import { resolveBuildEnv } from '#cli/codegen'
import { resolveCloudflareAccountId, resolveDeployProvider } from '#cli/commands/deploy'

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

  test('keeps direct CLI Cloudflare account fallback while app deploys ignore ambient targets', () => {
    expect(
      resolveCloudflareAccountId(undefined, { CLOUDFLARE_ACCOUNT_ID: ' ambient-account ' })
    ).toBe('ambient-account')
    expect(
      resolveCloudflareAccountId(' explicit-account ', {
        CLOUDFLARE_ACCOUNT_ID: 'ambient-account',
        OPENPENCIL_DEPLOY_IGNORE_AMBIENT_TARGET: '1'
      })
    ).toBe('explicit-account')
    expect(
      resolveCloudflareAccountId(undefined, {
        CLOUDFLARE_ACCOUNT_ID: 'ambient-account',
        OPENPENCIL_DEPLOY_IGNORE_AMBIENT_TARGET: '1'
      })
    ).toBeUndefined()
  })

  test('maps explicit Supabase build/deploy overrides including schema', () => {
    expect(
      resolveBuildEnv({
        supabaseUrl: 'https://staging.supabase.co',
        supabaseAnonKey: 'sb_publishable_example',
        supabaseSchema: 'app'
      })
    ).toEqual({
      VITE_SUPABASE_URL: 'https://staging.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_example',
      VITE_SUPABASE_SCHEMA: 'app'
    })
  })

  test('rejects an explicit secret key before it can be embedded in the client bundle', () => {
    expect(() => resolveBuildEnv({ supabaseAnonKey: 'sb_secret_do_not_embed' })).toThrow(
      'secret/service_role'
    )
  })

  test('rejects a secret key inherited from VITE_SUPABASE_ANON_KEY', () => {
    expect(() =>
      resolveBuildEnv({}, { VITE_SUPABASE_ANON_KEY: 'sb_secret_from_environment' })
    ).toThrow('secret/service_role')
  })

  test('ignores ambient VITE values in explicit app mode and uses private deploy values', () => {
    const ambient = {
      OPENPENCIL_DEPLOY_RUNTIME_MODE: 'explicit',
      VITE_SUPABASE_URL: 'https://ambient.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_ambient',
      VITE_SUPABASE_SCHEMA: 'ambient'
    }
    expect(resolveBuildEnv({}, ambient)).toBeUndefined()
    expect(
      resolveBuildEnv(
        {},
        {
          ...ambient,
          OPENPENCIL_DEPLOY_SUPABASE_URL: ' https://private.supabase.co ',
          OPENPENCIL_DEPLOY_SUPABASE_ANON_KEY: ' sb_publishable_private ',
          OPENPENCIL_DEPLOY_SUPABASE_SCHEMA: ' private_schema '
        }
      )
    ).toEqual({
      VITE_SUPABASE_URL: 'https://private.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_private',
      VITE_SUPABASE_SCHEMA: 'private_schema'
    })
  })

  test('keeps direct CLI VITE environment compatibility', () => {
    expect(
      resolveBuildEnv(
        {},
        {
          VITE_SUPABASE_URL: 'https://direct.supabase.co',
          VITE_SUPABASE_ANON_KEY: 'sb_publishable_direct',
          VITE_SUPABASE_SCHEMA: 'direct_schema'
        }
      )
    ).toEqual({
      VITE_SUPABASE_URL: 'https://direct.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_direct',
      VITE_SUPABASE_SCHEMA: 'direct_schema'
    })
  })

  test('requires URL/key pairs without mixing explicit app and ambient VITE values', () => {
    expect(() =>
      resolveBuildEnv({}, { VITE_SUPABASE_URL: 'https://only-url.supabase.co' })
    ).toThrow('must be provided together')
    expect(() =>
      resolveBuildEnv(
        {},
        {
          OPENPENCIL_DEPLOY_RUNTIME_MODE: 'explicit',
          OPENPENCIL_DEPLOY_SUPABASE_URL: 'https://private.supabase.co',
          VITE_SUPABASE_ANON_KEY: 'sb_publishable_ambient'
        }
      )
    ).toThrow('must be provided together')
  })

  test('validates Supabase URLs and schemas before building', () => {
    expect(() =>
      resolveBuildEnv({
        supabaseUrl: 'ftp://example.supabase.co',
        supabaseAnonKey: 'sb_publishable_example'
      })
    ).toThrow('must be HTTP(S)')
    expect(() =>
      resolveBuildEnv({
        supabaseUrl: 'https://user:password@example.supabase.co',
        supabaseAnonKey: 'sb_publishable_example'
      })
    ).toThrow('must not contain credentials')
    expect(() => resolveBuildEnv({ supabaseSchema: 'bad schema' })).toThrow('plain identifier')
  })
})
