import { describe, expect, test } from 'bun:test'

import { buildServerArtifacts } from '@open-pencil/compiler/adapters/react/lowcode/server-edge'
import {
  buildLowcodeSupabaseRuntime,
  buildSupabaseEnvExample,
  buildViteEnvDts
} from '@open-pencil/compiler/adapters/react/lowcode/supabase'
import {
  assembleLegacySupabaseServerArtifacts,
  buildLegacySupabaseClientRuntime,
  buildLegacySupabaseEnvironmentExample,
  buildLegacySupabaseViteEnvironmentTypes
} from '@open-pencil/compiler/backend'

describe('legacy React Supabase compatibility delegation', () => {
  test('delegates client runtime and environment bytes to the provider-owned helper', () => {
    const config = {
      url: 'https://example.supabase.co',
      anonKey: 'publishable-key',
      schema: 'private'
    }
    expect(buildLowcodeSupabaseRuntime(config)).toBe(buildLegacySupabaseClientRuntime(config))
    expect(buildSupabaseEnvExample(config)).toBe(buildLegacySupabaseEnvironmentExample(config))
    expect(buildViteEnvDts()).toBe(buildLegacySupabaseViteEnvironmentTypes())
  })

  test('delegates Edge artifact assembly while preserving the reviewed source bytes', () => {
    const workflows = [
      {
        id: 'send-message',
        name: 'Send message',
        params: ['message'],
        actions: [
          {
            kind: 'httpRequest' as const,
            method: 'POST' as const,
            url: { kind: 'env' as const, name: 'MESSAGES_API_URL' },
            headers: [
              {
                name: 'Authorization',
                value: { kind: 'env' as const, name: 'MESSAGES_API_TOKEN' }
              }
            ]
          },
          { kind: 'return' as const, references: [], status: 204 }
        ]
      }
    ]
    const actual = buildServerArtifacts(workflows)
    const providerOwned = assembleLegacySupabaseServerArtifacts({
      edgeFunction: actual.edgeFunction,
      workflows,
      environmentNames: ['MESSAGES_API_TOKEN', 'MESSAGES_API_URL']
    })
    expect(actual).toEqual(providerOwned)
  })
})
