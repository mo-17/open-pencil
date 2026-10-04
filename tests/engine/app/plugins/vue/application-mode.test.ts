import { describe, expect, test } from 'bun:test'

import { withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createVueSourceCompilerWorkerRequest,
  restoreVueCompilerGraph,
  validateVueSourceCompilerWorkerRequest
} from '@/app/plugins/host/vue/compiler/protocol'

import { expectDefined } from '#tests/helpers/assert'

describe('Vue compiler worker application metadata', () => {
  test('complete graph structured-clone transport preserves root/page contracts and design dependencies', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const root = expectDefined(graph.getNode(graph.rootId), 'root')
    const frame = graph.createNode('FRAME', page.id, { width: 360, height: 720 })
    const reference = graph.addPage('Components')
    reference.lowcodeApplicationPage = { version: 1, role: 'components' }
    root.lowcodeApplication = { version: 1, enabled: true, startPageId: page.id }
    page.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: frame.id }
    const request = structuredClone(
      createVueSourceCompilerWorkerRequest(
        {
          graph,
          pageIds: [page.id],
          options: withDefaults({ target: 'vue', router: 'vue-router-v4' })
        },
        'application-test'
      )
    )
    validateVueSourceCompilerWorkerRequest(request)
    const restored = restoreVueCompilerGraph(request.graph)
    expect(restored.getNode(restored.rootId)?.lowcodeApplication).toEqual(root.lowcodeApplication)
    expect(restored.getNode(page.id)?.lowcodeApplicationPage).toEqual(page.lowcodeApplicationPage)
    expect(restored.getNode(reference.id)?.lowcodeApplicationPage).toEqual(
      reference.lowcodeApplicationPage
    )
    expect(restored.nodes.size).toBe(graph.nodes.size)
    root.lowcodeApplication.enabled = false
    expect(restored.getNode(restored.rootId)?.lowcodeApplication?.enabled).toBe(true)
  })
})
