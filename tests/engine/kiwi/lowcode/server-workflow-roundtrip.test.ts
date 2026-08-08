import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { ServerWorkflowDef } from '@open-pencil/scene-graph'

import { LOWCODE_SERVER_WORKFLOWS_KEY } from '#core/kiwi/fig/node-change/lowcode-plugin-data'

setDefaultTimeout(30_000)

describe('server workflow .fig round-trip', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('preserves root lowcodeServerWorkflows independently from client workflows', async () => {
    const graph = new SceneGraph()
    const workflows: ServerWorkflowDef[] = [
      {
        id: 'process-order',
        name: 'Process order',
        trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
        params: ['orderId'],
        actions: [
          {
            id: 'load-order',
            kind: 'supabaseQuery',
            table: 'orders',
            filters: [{ column: 'id', op: 'eq', valueExpr: 'orderId' }],
            single: true,
            resultName: 'order'
          },
          {
            id: 'respond',
            kind: 'return',
            valueExpr: 'order',
            status: 200
          }
        ]
      }
    ]
    graph.updateNode(graph.rootId, { lowcodeServerWorkflows: workflows })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(reimported.getNode(reimported.rootId)?.lowcodeServerWorkflows).toEqual(workflows)
    expect(reimported.getNode(reimported.rootId)?.lowcodeWorkflows).toBeUndefined()
  })

  test('leaves the field undefined when no server workflows were authored', async () => {
    const graph = new SceneGraph()
    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(reimported.getNode(reimported.rootId)?.lowcodeServerWorkflows).toBeUndefined()
  })

  test('drops malicious server-workflow pluginData instead of hydrating it', async () => {
    const graph = new SceneGraph()
    const secret = ['sb_', 'secret_NEVER_IMPORT_123'].join('')
    const malicious = [
      {
        id: 'malicious',
        name: 'Malicious',
        trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
        actions: [{ id: 'leak', kind: 'return', valueExpr: JSON.stringify(secret) }]
      }
    ]
    graph.updateNode(graph.rootId, {
      pluginData: [
        {
          pluginId: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_SERVER_WORKFLOWS_KEY,
          value: JSON.stringify(malicious)
        }
      ]
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const root = reimported.getNode(reimported.rootId)

    expect(root?.lowcodeServerWorkflows).toBeUndefined()
    expect(JSON.stringify(root?.pluginData ?? [])).not.toContain(secret)
  })
})
