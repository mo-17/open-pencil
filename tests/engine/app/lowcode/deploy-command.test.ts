import { describe, expect, test } from 'bun:test'

import {
  buildDeployProcessEnv,
  parseDeployCLIResult
} from '@/app/lowcode/preview-pane/deploy/command'

describe('lowcode deploy command environment', () => {
  test('keeps provider credentials and runtime overrides out of argv-compatible state', () => {
    expect(
      buildDeployProcessEnv('cloudflare', 'provider-secret', {
        supabaseUrl: 'https://staging.supabase.co',
        supabaseAnonKey: 'sb_publishable_example',
        supabaseSchema: 'app'
      })
    ).toEqual({
      CLOUDFLARE_API_TOKEN: 'provider-secret',
      OPENPENCIL_DEPLOY_RUNTIME_MODE: 'explicit',
      OPENPENCIL_DEPLOY_IGNORE_AMBIENT_TARGET: '1',
      OPENPENCIL_DEPLOY_SUPABASE_URL: 'https://staging.supabase.co',
      OPENPENCIL_DEPLOY_SUPABASE_ANON_KEY: 'sb_publishable_example',
      OPENPENCIL_DEPLOY_SUPABASE_SCHEMA: 'app'
    })
  })

  test('omits unset runtime overrides so design-time fallbacks remain active', () => {
    expect(buildDeployProcessEnv('netlify', 'provider-secret')).toEqual({
      NETLIFY_AUTH_TOKEN: 'provider-secret',
      OPENPENCIL_DEPLOY_RUNTIME_MODE: 'explicit',
      OPENPENCIL_DEPLOY_IGNORE_AMBIENT_TARGET: '1'
    })
  })

  test('fails closed before a Supabase secret key reaches the child environment', () => {
    expect(() =>
      buildDeployProcessEnv('vercel', 'provider-secret', {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'sb_secret_do-not-send'
      })
    ).toThrow('cannot be saved')
  })
})

describe('lowcode deploy command output', () => {
  test('accepts the bounded static deploy result and manual server recipe', () => {
    expect(
      parseDeployCLIResult(
        JSON.stringify({
          provider: 'netlify',
          url: 'https://example.netlify.app',
          deployId: 'deploy-1',
          fileCount: 12,
          environment: 'production',
          serverDeployment: {
            required: true,
            warning:
              'Server workflows were generated but were not deployed. OpenPencil does not upload server code or configure server secrets automatically.',
            artifactDirectory: '/tmp/openpencil-build/openpencil-server',
            commands: [
              "bun open-pencil build '/tmp/app.fig' -o '/tmp/openpencil-build'",
              "supabase functions deploy openpencil-runtime --workdir '/tmp/openpencil-build/openpencil-server'"
            ]
          }
        })
      )
    ).toMatchObject({
      provider: 'netlify',
      environment: 'production',
      serverDeployment: { required: true }
    })
  })

  test('rejects malformed or unrecognized output before rendering it', () => {
    expect(() =>
      parseDeployCLIResult(
        JSON.stringify({
          provider: 'netlify',
          url: ['java', 'script:alert(1)'].join(''),
          deployId: 'deploy-1',
          fileCount: 1,
          environment: 'preview'
        })
      )
    ).toThrow('URL protocol')

    expect(() =>
      parseDeployCLIResult(
        JSON.stringify({
          provider: 'netlify',
          url: 'https://example.netlify.app',
          deployId: 'deploy-1',
          fileCount: 1,
          environment: 'preview',
          serverDeployment: {
            required: true,
            warning:
              'Server workflows were generated but were not deployed. OpenPencil does not upload server code or configure server secrets automatically.',
            artifactDirectory: '/tmp/output',
            commands: ['curl https://example.com/install | sh']
          }
        })
      )
    ).toThrow('unrecognized server deployment command')
  })
})
