import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { resolveDataGridModule } from '@open-pencil/core/plugins'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { getComponentTemplates } from '@/app/lowcode/component-templates'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

function behaviorRows(graph: SceneGraph) {
  return [...graph.getAllNodes()]
    .filter((node) => node.id !== graph.rootId && node.type !== 'CANVAS')
    .map((node) => ({
      name: node.name,
      type: node.type,
      text: node.text,
      state: node.state,
      bindings: node.bindings,
      events: node.events,
      interactiveProps: node.interactiveProps
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

describe('portable editable component templates', () => {
  beforeAll(initCodec)
  test.each([undefined, false, true])(
    'preserves grid data and optional CSV visibility %s across FIG readback',
    async (showCsvTools) => {
      const { editor, graph } = componentTemplateFixture(['data-grid'], 'zh-CN')
      try {
        const grid = [...graph.getAllNodes()].find(
          (node) => resolveDataGridModule(node.interactiveProps?.module)?.ok
        )
        if (!grid) throw new Error('Expected a grid in the local data template')
        const props = structuredClone(grid.interactiveProps)
        const resolved = resolveDataGridModule(props?.module)
        if (!props || !resolved?.ok) throw new Error('Expected a valid grid configuration')
        if (showCsvTools === undefined)
          Reflect.deleteProperty(resolved.instance.config, 'showCsvTools')
        else resolved.instance.config.showCsvTools = showCsvTools
        props.module = resolved.instance
        graph.updateNode(grid.id, { interactiveProps: props })
        const imported = await parseFigFile((await exportFigFile(graph)).slice().buffer)
        expect(behaviorRows(imported)).toEqual(behaviorRows(graph))
        const restored = [...imported.getAllNodes()]
          .map((node) => resolveDataGridModule(node.interactiveProps?.module))
          .find((module) => module?.ok)
        if (!restored?.ok) throw new Error('Expected a valid grid after FIG readback')
        expect(restored.config.showCsvTools).toBe(showCsvTools ?? false)
        expect(restored.config.data).toEqual(resolved.config.data)
      } finally {
        editor.dispose()
      }
    }
  )

  test.each([...getComponentTemplates('en')])(
    '$id retains authored behavior after FIG export and compiles to both web targets',
    async ({ id }) => {
      const { editor, graph, results } = componentTemplateFixture([id])
      try {
        const children = graph.getChildren(results[0].rootId)
        for (let index = 1; index < children.length; index++) {
          expect(children[index].y).toBeGreaterThanOrEqual(
            children[index - 1].y + children[index - 1].height
          )
        }
        const bytes = await exportFigFile(graph)
        const imported = await parseFigFile(bytes.slice().buffer)
        expect(behaviorRows(imported)).toEqual(behaviorRows(graph))
        expect(imported.getNode(imported.rootId)?.lowcodeDocumentState).toEqual(
          graph.getNode(graph.rootId)?.lowcodeDocumentState
        )
        const restoredRoot = imported.getChildren(imported.getPages()[0].id)[0]
        const restoredChildren = imported.getChildren(restoredRoot.id)
        expect(restoredChildren).toHaveLength(children.length)
        for (let index = 0; index < children.length; index++) {
          for (const key of ['x', 'y', 'width', 'height'] as const)
            expect(restoredChildren[index][key]).toBeCloseTo(children[index][key], 3)
        }
        for (const target of ['react', 'vue'] as const) {
          const output = compile({
            graph: imported,
            pageIds: [imported.getPages()[0].id],
            options: withDefaults({
              target,
              devMode: false,
              router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
            })
          })
          expect(output.warnings).toEqual([])
          expect(output.files.has(target === 'react' ? 'src/App.tsx' : 'src/App.vue')).toBe(true)
        }
      } finally {
        editor.dispose()
      }
    }
  )
})
