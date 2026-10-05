import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parsePenFile, serializePenFile } from '@open-pencil/pen'

for (const foreign of ['self', 'descendant'] as const) {
  test(`PEN rejects ${foreign} geometry in native instance state beside a valid Motion clear`, () => {
    const graph = parsePenFile(
      JSON.stringify({
        version: '2.14',
        children: [
          { id: 'component', type: 'frame', reusable: true, width: 20, height: 20 },
          { id: 'instance', type: 'ref', ref: 'component' }
        ]
      })
    )
    const editor = createEditor({ graph })
    editor.updateNodeWithUndo(
      'instance',
      { motion: undefined, overrides: { motion: null } },
      'Clear'
    )
    const node = graph.getNode('instance')
    if (!node) throw new Error('Expected imported instance')
    if (foreign === 'self') node.instanceOverrides.self.set('width', true)
    else node.instanceOverrides.descendants.set('child', new Map([['width', true]]))
    graph.updateNode(node.id, { instanceOverrides: node.instanceOverrides })
    expect(() => serializePenFile(graph)).toThrow(/unsupported edits \(instanceOverrides\)/)
    editor.dispose()
  })
}
