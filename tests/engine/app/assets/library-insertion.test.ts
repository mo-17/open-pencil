import { expect, test } from 'bun:test'

import { MemoryLibraryCatalog } from '@open-pencil/core/library'
import { SceneGraph } from '@open-pencil/scene-graph'

import { LibraryService } from '@/app/libraries/service'

class DeferredCatalog extends MemoryLibraryCatalog {
  readonly gate = Promise.withResolvers<undefined>()
  override async getRevision(libraryId: string, revisionId?: string) {
    await this.gate.promise
    return super.getRevision(libraryId, revisionId)
  }
}

test('checks the target after async library loading and before mutating either graph', async () => {
  const source = new SceneGraph()
  source.createNode('COMPONENT', source.getPages()[0].id, { name: 'Card', componentKey: 'card' })
  const catalog = new DeferredCatalog()
  const revision = await catalog.publishRevision({
    libraryId: 'cards',
    name: 'Cards',
    graph: source
  })
  const original = new SceneGraph()
  const replacement = new SceneGraph()
  const target = {
    graph: original,
    requestRender() {
      throw new Error('Unexpected render')
    }
  }
  const service = new LibraryService(catalog)
  const originalSize = original.nodes.size
  const replacementSize = replacement.nodes.size
  const insertion = service.materialize(
    target,
    'cards',
    revision.manifest.revisionId,
    'card',
    () => {
      if (target.graph !== original) throw new Error('Target changed')
    }
  )
  target.graph = replacement
  catalog.gate.resolve(undefined)
  await expect(insertion).rejects.toThrow('Target changed')
  expect(original.nodes.size).toBe(originalSize)
  expect(replacement.nodes.size).toBe(replacementSize)
})
