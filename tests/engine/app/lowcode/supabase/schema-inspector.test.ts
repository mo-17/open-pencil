import { afterEach, describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref, type EffectScope } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import type { SupabaseSchemaCatalog } from '@/app/lowcode/supabase/schema-catalog'
import {
  useSupabaseSchemaInspector,
  type SupabaseSchemaInspectorDependencies
} from '@/app/lowcode/supabase/schema-inspector'

const cachedCatalog: SupabaseSchemaCatalog = {
  version: 1,
  projectRef: 'project-ref',
  schema: 'public',
  tables: [
    {
      name: 'todos',
      required: ['id'],
      columns: [{ name: 'id', type: 'integer', required: true, nullable: false }],
      relations: []
    }
  ]
}

const scopes: EffectScope[] = []

function createInspector(
  config = ref<SupabaseConfig | undefined>({
    url: 'https://project-ref.supabase.co',
    anonKey: 'public-anon-key'
  }),
  dependencies: Partial<SupabaseSchemaInspectorDependencies> = {}
) {
  const scope = effectScope()
  scopes.push(scope)
  const inspector = scope.run(() => useSupabaseSchemaInspector(config, dependencies))
  if (!inspector) throw new Error('Schema inspector scope did not start.')
  return { config, inspector, scope }
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})

describe('Supabase schema inspector state', () => {
  test('shows cached data before replacing it with a live normalized catalog', async () => {
    const calls: string[] = []
    const secret = 'pat-must-not-enter-state'
    const { inspector } = createInspector(undefined, {
      readCache: async () => {
        calls.push('cache')
        return { status: 'hit', catalog: cachedCatalog, cachedAt: 1000 }
      },
      credentialStatus: async () => 'configured',
      resolveCredential: async () => {
        calls.push('resolve')
        return secret
      },
      fetchOpenAPI: async (request) => {
        calls.push('fetch')
        expect(request.personalAccessToken).toBe(secret)
        return {
          projectRef: 'project-ref',
          schema: 'public',
          openApi: {
            definitions: {
              profiles: {
                required: ['id'],
                properties: { id: { type: 'string', format: 'uuid' } }
              }
            }
          }
        }
      },
      writeCache: async (catalog) => {
        calls.push('write')
        expect(catalog.tables[0]?.name).toBe('profiles')
        expect(JSON.stringify(catalog)).not.toContain(secret)
        expect(JSON.stringify(catalog)).not.toContain('definitions')
      }
    })

    await nextTick()
    await Bun.sleep(0)
    calls.length = 0
    await inspector.inspect()

    expect(calls).toEqual(['cache', 'resolve', 'fetch', 'write'])
    expect(inspector.source.value).toBe('live')
    expect(inspector.requestState.value).toBe('success')
    expect(inspector.catalog.value?.tables[0]?.name).toBe('profiles')
    expect(
      JSON.stringify({
        catalog: inspector.catalog.value,
        error: inspector.error.value,
        credentialStatus: inspector.credentialStatus.value
      })
    ).not.toContain(secret)
  })

  test('keeps a cached catalog visible when no PAT is configured', async () => {
    let fetchCalls = 0
    const { inspector } = createInspector(undefined, {
      readCache: async () => ({ status: 'hit', catalog: cachedCatalog, cachedAt: 1000 }),
      credentialStatus: async () => 'missing',
      resolveCredential: async () => null,
      fetchOpenAPI: async () => {
        fetchCalls += 1
        throw new Error('must not fetch without a credential')
      }
    })

    await inspector.inspect()

    expect(fetchCalls).toBe(0)
    expect(inspector.source.value).toBe('cached')
    expect(inspector.catalog.value).toEqual(cachedCatalog)
    expect(inspector.requestState.value).toBe('missing-credential')
    expect(inspector.error.value).toBe('missing-credential')
  })

  test('aborts an in-flight request when the config changes', async () => {
    let requestSignal: AbortSignal | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const { config, inspector } = createInspector(undefined, {
      readCache: async () => ({ status: 'miss' }),
      credentialStatus: async () => 'configured',
      resolveCredential: async () => 'transient-pat',
      fetchOpenAPI: (request) => {
        requestSignal = request.signal
        markStarted?.()
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
      }
    })

    const inspection = inspector.inspect()
    await started
    config.value = {
      url: 'https://another-project.supabase.co',
      anonKey: 'public-anon-key',
      schema: 'private'
    }
    await nextTick()
    await inspection
    await inspector.loadCachedCatalog()

    expect(requestSignal?.aborted).toBe(true)
    expect(inspector.catalog.value).toBeNull()
    expect(inspector.cacheState.value).toBe('miss')
    expect(inspector.error.value).toBeNull()
  })

  test('aborts an in-flight request when its effect scope is disposed', async () => {
    let requestSignal: AbortSignal | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const { inspector, scope } = createInspector(undefined, {
      readCache: async () => ({ status: 'miss' }),
      credentialStatus: async () => 'configured',
      resolveCredential: async () => 'transient-pat',
      fetchOpenAPI: (request) => {
        requestSignal = request.signal
        markStarted?.()
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
      }
    })

    const inspection = inspector.inspect()
    await started
    scope.stop()
    await inspection

    expect(requestSignal?.aborted).toBe(true)
  })

  test('saves and clears credentials without exposing the PAT in reactive state', async () => {
    let stored = ''
    const secret = 'pat-only-in-credential-call'
    const { inspector } = createInspector(undefined, {
      readCache: async () => ({ status: 'miss' }),
      credentialStatus: async () => (stored ? 'configured' : 'missing'),
      setCredential: async (value) => {
        stored = value
      },
      clearCredential: async () => {
        stored = ''
      }
    })

    await expect(inspector.saveCredential(secret)).resolves.toBe(true)
    expect(stored).toBe(secret)
    expect(inspector.credentialStatus.value).toBe('configured')
    expect(JSON.stringify(inspector)).not.toContain(secret)

    await expect(inspector.clearCredential()).resolves.toBe(true)
    expect(stored).toBe('')
    expect(inspector.credentialStatus.value).toBe('missing')
  })
})

describe('Supabase schema inspector component', () => {
  test('uses an uncontrolled password field and clears its DOM value', async () => {
    const source = await Bun.file(
      'src/components/properties/Lowcode/SupabaseSchemaInspector.vue'
    ).text()
    const parentSource = await Bun.file(
      'src/components/properties/Lowcode/SupabaseConfigPanel.vue'
    ).text()
    expect(source).toContain('type="password"')
    expect(source).not.toContain('v-model')
    expect(source).toContain("input.value = ''")
    expect(parentSource).toContain('<SupabaseSchemaInspector :config="config" />')
  })
})
