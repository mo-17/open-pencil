import { describe, expect, test } from 'bun:test'

import {
  inspectMotionDriverSourceBindings,
  motionDriverDocumentStates,
  motionDriverPageStates,
  motionDriverVariables
} from '@open-pencil/motion'
import { SceneGraph, type MotionDriverSpecV1 } from '@open-pencil/scene-graph'

describe('continuous Motion driver sources', () => {
  test('enumerates only scalar page, document, and design-variable inputs', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const owner = graph.createNode('FRAME', page.id)
    graph.updateNode(page.id, {
      state: [
        { id: 'page-progress', name: 'progress', type: 'number', defaultValue: 0 },
        { id: 'page-label', name: 'label', type: 'string', defaultValue: '' }
      ]
    })
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'doc-enabled', name: 'enabled', type: 'boolean', defaultValue: false },
        { id: 'doc-data', name: 'data', type: 'object', defaultValue: {} }
      ]
    })
    const collection = graph.createCollection('Motion inputs')
    const progress = graph.createVariable('Progress', 'FLOAT', collection.id, 0.25)
    const enabled = graph.createVariable('Enabled', 'BOOLEAN', collection.id, true)
    graph.createVariable('Label', 'STRING', collection.id, 'ignored')

    expect(motionDriverPageStates(graph, owner).map(({ id }) => id)).toEqual(['page-progress'])
    expect(motionDriverDocumentStates(graph).map(({ id }) => id)).toEqual(['doc-enabled'])
    expect(motionDriverVariables(graph).map(({ id }) => id)).toEqual([progress.id, enabled.id])
  })

  test('reports every unresolved or non-scalar source with a stable path', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const owner = graph.createNode('FRAME', page.id)
    graph.updateNode(page.id, {
      state: [{ id: 'page-label', name: 'label', type: 'string', defaultValue: '' }]
    })
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'doc-data', name: 'data', type: 'object', defaultValue: {} }]
    })
    const collection = graph.createCollection('Motion inputs')
    const label = graph.createVariable('Label', 'STRING', collection.id, 'ignored')
    const spec: MotionDriverSpecV1 = {
      version: 1,
      drivers: [
        driver('missing-page', { kind: 'pageState', stateId: 'missing' }),
        driver('string-page', { kind: 'pageState', stateId: 'page-label' }),
        driver('object-document', { kind: 'documentState', stateId: 'doc-data' }),
        driver('string-variable', { kind: 'variable', variableId: label.id }),
        driver('missing-variable', { kind: 'variable', variableId: 'missing' })
      ]
    }

    expect(inspectMotionDriverSourceBindings(graph, owner, spec)).toMatchObject([
      { driverId: 'missing-page', code: 'page-state-missing' },
      { driverId: 'string-page', code: 'page-state-type-unsupported' },
      { driverId: 'object-document', code: 'document-state-type-unsupported' },
      { driverId: 'string-variable', code: 'variable-type-unsupported' },
      { driverId: 'missing-variable', code: 'variable-missing' }
    ])
  })
})

function driver(
  id: string,
  source: MotionDriverSpecV1['drivers'][number]['source']
): MotionDriverSpecV1['drivers'][number] {
  return {
    id,
    source,
    target: { targetNodeId: 'target', trackId: 'track' },
    mapping: { inputMin: 0, inputMax: 1 }
  }
}
