import { describe, expect, test } from 'bun:test'

import {
  lowerLegacySupabaseApplication,
  parseBackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('legacy backend compatibility lowering', () => {
  test('normalizes existing client data/auth/storage usage as external, deny-by-default IR', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://example.supabase.co',
        anonKey: 'legacy-public-anon-value',
        schema: 'public'
      }
    })
    graph.createNode('BUTTON', pageId, {
      name: 'Save',
      events: {
        onClick: [
          {
            id: 'save-note',
            kind: 'supabaseMutation',
            operation: 'insert',
            table: 'notes',
            payloadEntries: [{ key: 'title', valueExpr: 'draftTitle' }]
          },
          { id: 'sign-out', kind: 'supabaseAuth', operation: 'signOut' }
        ]
      }
    })
    graph.createNode('INPUT', pageId, {
      name: 'Upload',
      interactiveProps: { upload: { bucket: 'attachments' } }
    })

    const result = lowerLegacySupabaseApplication(graph)
    expect(result.spec.dataModel.entities.every((entry) => entry.management === 'external')).toBe(
      true
    )
    expect(result.spec.auth.rowAccess.every((entry) => entry.effect === 'deny')).toBe(true)
    expect(result.spec.capabilities.map((entry) => entry.capability)).toContain('data.write')
    expect(result.spec.capabilities.map((entry) => entry.capability)).toContain('storage.objects')
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      'legacy-backend-auth-intent-required'
    )
    expect(parseBackendApplicationSpecV1(result.spec).ok).toBe(true)
    const serialized = JSON.stringify(result.spec)
    expect(serialized).not.toContain('legacy-public-anon-value')
    expect(serialized.toLowerCase()).not.toContain('supabase')
  })

  test('lowers validated server workflows and keeps only environment names', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://example.supabase.co',
        anonKey: 'public-key',
        schema: 'public'
      },
      lowcodeServerWorkflows: [
        {
          id: 'create-note',
          name: 'Create note',
          trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
          params: ['title'],
          actions: [
            {
              id: 'insert-note',
              kind: 'supabaseMutation',
              operation: 'insert',
              table: 'notes',
              payloadEntries: [{ key: 'title', valueExpr: 'title' }],
              resultName: 'created'
            },
            {
              id: 'notify',
              kind: 'httpRequest',
              method: 'POST',
              url: { kind: 'env', name: 'WEBHOOK_URL' },
              headers: [
                {
                  name: 'Authorization',
                  value: { kind: 'env', name: 'WEBHOOK_TOKEN' }
                }
              ],
              body: { kind: 'expr', expr: 'created' }
            },
            { id: 'return-created', kind: 'return', valueExpr: 'created', status: 201 }
          ]
        }
      ]
    })
    const result = lowerLegacySupabaseApplication(graph)
    expect(result.spec.workflows.workflows).toHaveLength(1)
    expect(result.spec.workflows.workflows[0].steps.map((entry) => entry.kind)).toEqual([
      'data.mutate',
      'http.request',
      'respond'
    ])
    expect(result.spec.secrets.map((entry) => entry.name)).toEqual([
      'BACKEND_PUBLIC_KEY',
      'BACKEND_PUBLIC_URL',
      'WEBHOOK_TOKEN',
      'WEBHOOK_URL'
    ])
    expect(JSON.stringify(result.spec)).not.toContain('public-key')
    expect(parseBackendApplicationSpecV1(result.spec).ok).toBe(true)
  })

  test('keeps an unconfigured legacy query capability-complete for safe review artifacts', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    graph.createNode('LIST', pageId, {
      name: 'Products',
      interactiveProps: {
        dataSourceRef: { kind: 'supabaseQuery', query: { table: 'products' } }
      }
    })

    const result = lowerLegacySupabaseApplication(graph)
    expect(result.spec.capabilities.map((entry) => entry.capability)).toEqual([
      'auth.identity',
      'data.read',
      'policy.row-level'
    ])
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      'legacy-backend-auth-intent-required'
    )
    expect(parseBackendApplicationSpecV1(result.spec).ok).toBe(true)
  })
})
