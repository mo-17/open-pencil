import { describe, expect, test } from 'bun:test'

import { BUILTIN_IO_FORMATS, exportFigFile, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('IORegistry document readers', () => {
  test('reads an explicitly selected format and forwards fig population options', async () => {
    const source = new SceneGraph()
    const page = source.getPages()[0]
    const component = source.createNode('COMPONENT', page.id, { name: 'Card' })
    source.createNode('RECTANGLE', component.id, { name: 'Card background' })
    const instance = source.createInstance(component.id, page.id)
    expect(instance).not.toBeNull()
    if (!instance) return
    source.updateNode(instance.id, { name: 'Card instance' })

    const data = await exportFigFile(source)
    const registry = new IORegistry(BUILTIN_IO_FORMATS)
    const input = { name: 'library-without-extension', data }
    const unpopulated = await registry.readDocumentAs('fig', input, { populate: 'none' })
    const populated = await registry.readDocumentAs('fig', input, { populate: 'all' })
    const unpopulatedInstance = [...unpopulated.graph.getAllNodes()].find(
      (node) => node.name === 'Card instance'
    )
    const populatedInstance = [...populated.graph.getAllNodes()].find(
      (node) => node.name === 'Card instance'
    )

    expect(unpopulated.sourceFormat).toBe('fig')
    expect(unpopulatedInstance?.childIds).toEqual([])
    expect(populatedInstance?.childIds).toHaveLength(1)
  })

  test('keeps automatic reader selection and reports unsupported explicit formats', async () => {
    const registry = new IORegistry(BUILTIN_IO_FORMATS)
    const data = new TextEncoder().encode('{"version":"2.14","children":[]}\n')

    const result = await registry.readDocument({ name: 'legacy.pen', data })
    expect(result.sourceFormat).toBe('pen')
    await expect(registry.readDocumentAs('missing', { data })).rejects.toThrow(
      'Format does not support readDocument: missing'
    )
  })
})
