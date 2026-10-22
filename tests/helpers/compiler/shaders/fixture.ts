import { readFile } from 'node:fs/promises'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph, readShaderPaints } from '@open-pencil/scene-graph'

import { repoPath } from '#tests/helpers/paths'

/** A saved content image beside live controls, compiled in Bun like other compiler fixtures. */
export async function compileShaderControls(target: 'react' | 'vue') {
  const graph = new SceneGraph()
  const owner = graph.getPages()[0]
  graph.updateNode(owner.id, {
    state: [{ id: 'value', name: 'value', type: 'string', defaultValue: 'initial' }]
  })
  const decoration = graph.createNode('FRAME', owner.id, {
    name: 'Decoration',
    x: 20,
    y: 20,
    width: 180,
    height: 100,
    fills: []
  })
  graph.createNode('TEXT', decoration.id, { text: 'Editable source', width: 160, height: 30 })
  const editor = createEditor({ graph })
  editor.setContentShader([decoration.id])
  // Exercise the no-GPU export boundary with a real saved image; GPU generation has its own test.
  graph.images.set(
    readShaderPaints(decoration)[0].image,
    new Uint8Array(await readFile(repoPath('tests/fixtures/vectorize/pilot_avatar.png')))
  )
  graph.createNode('BUTTON', owner.id, {
    x: 20,
    y: 140,
    width: 140,
    height: 36,
    interactiveProps: { text: 'Set value' },
    events: {
      onClick: [
        { id: 'set-value', kind: 'setState', targetStateId: 'value', valueExpr: "'clicked'" }
      ]
    }
  })
  graph.createNode('INPUT', owner.id, {
    x: 20,
    y: 190,
    width: 180,
    height: 36,
    bindings: { value: { kind: 'ref', stateId: 'value' } }
  })
  graph.createNode('SELECT', owner.id, {
    x: 20,
    y: 240,
    width: 180,
    height: 36,
    interactiveProps: {
      options: [
        { label: 'Alpha', value: 'a' },
        { label: 'Beta', value: 'b' }
      ]
    },
    bindings: { value: { kind: 'ref', stateId: 'value' } }
  })
  const feedback = graph.createNode('TEXT', owner.id, {
    x: 20,
    y: 290,
    width: 200,
    height: 36,
    text: 'value',
    bindings: { text: { kind: 'ref', stateId: 'value' } }
  })
  const output = compile({
    graph,
    pageIds: [owner.id],
    options: withDefaults({ target, packageName: 'shader-controls' })
  })
  editor.dispose()
  return {
    feedbackId: feedback.id,
    files: [...output.files].map(([path, content]) => [
      path,
      typeof content === 'string' ? content : Array.from(content)
    ])
  }
}
