import { describe, expect, test } from 'bun:test'

import { compile, withDefaults, type CompilerBackendProviderRequest } from '@open-pencil/compiler'
import {
  BACKEND_ARTIFACT_MANIFEST_PATH,
  NESTJS_BACKEND_PROVIDER_BUNDLE,
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  backendProviderPlanDigest,
  createBackendProviderPlan,
  createBackendProviderRegistry,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan
} from '@open-pencil/compiler/backend'
import { SceneGraph } from '@open-pencil/scene-graph'

import { HTTP_API_DIAGNOSTIC } from '../http-api/helpers'
import { nestJSApplication } from './helpers'

function request(): CompilerBackendProviderRequest {
  return {
    selection: {
      descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: `sha256:${'A'.repeat(43)}`,
      enabled: true
    },
    application: nestJSApplication()
  }
}

function graph() {
  const result = new SceneGraph()
  result.createNode('FRAME', result.getPages()[0].id, { name: 'NestJS frontend' })
  return result
}

function compileGraph(source: SceneGraph, target: 'react' | 'vue' = 'react') {
  return compile({
    graph: source,
    pageIds: [source.getPages()[0].id],
    options: withDefaults({ target, devMode: false, backendProvider: request() })
  })
}

describe('NestJS trusted compiler integration', () => {
  test.each(['react', 'vue'] as const)(
    'plans, replays and integrates complete %s server sources',
    (target) => {
      const registry = createBuiltinBackendProviderRegistry()
      const input = request()
      const planned = createBackendProviderPlan(registry, { ...input, target, mode: 'production' })
      expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
      if (!planned.ok) throw new Error('Expected NestJS plan')
      const emitted = emitBackendProviderPlan(registry, {
        selection: input.selection,
        plan: planned.plan
      })
      expect(emitted.ok, JSON.stringify(emitted.ok ? [] : emitted.diagnostics)).toBe(true)
      if (!emitted.ok) throw new Error('Expected NestJS sources')
      expect(emitted.emission.manifest).toMatchObject({
        authority: { providerId: 'nestjs' },
        target,
        mode: 'production'
      })
      expect(emitted.emission.files.has('backend/nestjs/package.json')).toBe(true)
      expect(emitted.emission.files.has('backend/nestjs/src/main.ts')).toBe(true)
      const output = compileGraph(graph(), target)
      expect(output.files.has(BACKEND_ARTIFACT_MANIFEST_PATH)).toBe(true)
      for (const [path, content] of emitted.emission.files)
        expect(output.files.get(path)).toEqual(content)
      expect([...output.files.keys()].some((path) => path.includes('supabase'))).toBe(false)
    }
  )

  test.each(['preview', 'source-only-prototype'] as const)(
    'rejects %s including recomputed plan replay',
    (mode) => {
      const registry = createBuiltinBackendProviderRegistry()
      const input = request()
      const planned = createBackendProviderPlan(registry, {
        ...input,
        target: 'react',
        mode: 'production'
      })
      if (!planned.ok) throw new Error('Expected initial NestJS plan')
      const changed = { ...planned.plan, mode }
      changed.planDigest = backendProviderPlanDigest(changed)
      expect(createBackendProviderPlan(registry, { ...input, target: 'react', mode }).ok).toBe(
        false
      )
      expect(
        emitBackendProviderPlan(registry, { selection: input.selection, plan: changed }).ok
      ).toBe(false)
    }
  )

  test('requires the whole reviewed descriptor, not a provider ID or HTTP capability', () => {
    let validations = 0
    const descriptor = { ...NESTJS_BACKEND_PROVIDER_DESCRIPTOR, adapterVersion: '1.0.1' }
    const registry = createBackendProviderRegistry([
      {
        ...NESTJS_BACKEND_PROVIDER_BUNDLE,
        descriptor,
        validate() {
          validations += 1
          return []
        }
      }
    ])
    const input = request()
    const result = createBackendProviderPlan(registry, {
      ...input,
      selection: { ...input.selection, descriptor },
      target: 'react',
      mode: 'production'
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining(HTTP_API_DIAGNOSTIC))
    expect(validations).toBe(0)
  })

  test('rejects disabled and descriptor-substituted builtin selections', () => {
    const registry = createBuiltinBackendProviderRegistry()
    const input = request()
    for (const selection of [
      { ...input.selection, enabled: false },
      {
        ...input.selection,
        descriptor: { ...input.selection.descriptor, contributionId: 'forged.backend' }
      }
    ]) {
      expect(
        createBackendProviderPlan(registry, {
          ...input,
          selection,
          target: 'react',
          mode: 'production'
        }).ok
      ).toBe(false)
    }
  })

  test.each(['config', 'action', 'list', 'upload', 'guard', 'workflow'] as const)(
    'rejects existing Supabase %s intent instead of silently retaining its client',
    (kind) => {
      const source = graph()
      const pageId = source.getPages()[0].id
      if (kind === 'config')
        source.updateNode(source.rootId, {
          lowcodeSupabaseConfig: {
            url: 'https://example.supabase.co',
            anonKey: 'public-fixture-key'
          }
        })
      if (kind === 'action')
        source.createNode('BUTTON', pageId, {
          events: {
            onClick: [
              {
                id: 'query',
                kind: 'supabaseQuery',
                table: 'notes',
                columns: 'id',
                resultTarget: 'notes'
              }
            ]
          }
        })
      if (kind === 'list')
        source.createNode('LIST', pageId, {
          interactiveProps: { dataSourceRef: { kind: 'supabaseQuery', query: { table: 'notes' } } }
        })
      if (kind === 'upload')
        source.createNode('INPUT', pageId, {
          interactiveProps: { upload: { bucket: 'attachments', resultTarget: 'fileURL' } }
        })
      if (kind === 'guard') source.updateNode(pageId, { lowcodeRequiresAuth: true })
      if (kind === 'workflow')
        source.createNode('BUTTON', pageId, {
          events: {
            onClick: [
              { id: 'invoke', kind: 'invokeServerWorkflow', workflowId: 'existing', args: {} }
            ]
          }
        })
      expect(() => compileGraph(source)).toThrow('backend-provider-client-runtime-conflict')
    }
  )

  test('keeps an ordinary form without Supabase bindings compatible', () => {
    const source = graph()
    const form = source.createNode('FORM', source.getPages()[0].id, { name: 'Local form' })
    source.createNode('INPUT', form.id, { name: 'Title', interactiveProps: { name: 'title' } })
    expect(compileGraph(source).files.has('backend/nestjs/src/main.ts')).toBe(true)
  })
})
