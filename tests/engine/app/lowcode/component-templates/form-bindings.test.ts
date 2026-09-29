import { expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { moduleValueFields } from '@open-pencil/core/plugins'

import { createComponentTemplate } from '@/app/lowcode/component-templates'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

for (const id of ['slider', 'range-slider', 'rating', 'date-range', 'cascader'] as const)
  test(`${id} template owns typed page state, independent copies and atomic undo`, async () => {
    const { editor, graph, pageId } = componentTemplateFixture([])
    try {
      const first = createComponentTemplate(editor, id, 'zh-CN', { parentId: pageId })
      const second = createComponentTemplate(editor, id, 'en', { parentId: pageId })
      const modules = [first, second].map((result) =>
        result.nodeIds
          .map((nodeId) => graph.getNode(nodeId))
          .find((node) => node?.interactiveProps?.module)
      )
      const bindings = modules.map((node) => {
        if (!node) throw new Error('Missing template module')
        return moduleValueFields(node).map((field) => {
          const binding = node.bindings?.[field.key]
          if (binding?.kind !== 'ref') throw new Error('Expected page state binding')
          const state = graph.getNode(pageId)?.state?.find((entry) => entry.id === binding.stateId)
          expect(state).toMatchObject({ type: field.type, defaultValue: field.initialValue })
          return binding.stateId
        })
      })
      expect(bindings[0]).toHaveLength(id === 'range-slider' || id === 'date-range' ? 2 : 1)
      expect(bindings[0].some((state) => bindings[1].includes(state))).toBe(false)
      editor.undo.undo()
      expect(graph.getNode(second.rootId)).toBeUndefined()
      expect(
        bindings[1].some((state) =>
          graph.getNode(pageId)?.state?.some((entry) => entry.id === state)
        )
      ).toBe(false)
      expect(graph.getNode(first.rootId)).toBeDefined()
      editor.undo.redo()
      await initCodec()
      const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
      const restoredBindings = [...restored.getAllNodes()]
        .filter((node) => node.interactiveProps?.module)
        .map((node) => JSON.stringify(node.bindings))
        .sort()
      expect(restoredBindings).toEqual(modules.map((node) => JSON.stringify(node?.bindings)).sort())
      expect(restored.getPages()[0].state).toEqual(graph.getNode(pageId)?.state)
    } finally {
      editor.dispose()
    }
  })
