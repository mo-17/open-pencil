import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import {
  moduleValueFields,
  resolveTreeModule,
  treeSelectedIds,
  type TreeModuleConfigV1
} from '@open-pencil/core/plugins'
import { collectReferences, parseExpression } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createComponentTemplate } from '@/app/lowcode/component-templates'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function assertDetailExpressions(nodes: SceneNode[], stateId: string): SceneNode[] {
  const texts = nodes.filter((node) => node.bindings?.text)
  expect(texts).toHaveLength(3)
  for (const node of texts) {
    const text = node.bindings?.text
    if (text?.kind !== 'expr' || typeof text.expr !== 'string')
      throw new Error('Expected ordinary text expression')
    const parsed = parseExpression(text.expr)
    if (!parsed.ok) throw new Error('Expected portable detail expression')
    expect([...collectReferences(parsed.ast)]).toEqual([stateId])
  }
  return texts
}

function assertSingleSelection(config: TreeModuleConfigV1): void {
  for (const id of ['project', 'design', 'development', 'research'])
    expect(treeSelectedIds(config, id)).toEqual([id])
  expect(treeSelectedIds(config, 'archive')).toBeNull()
  expect(treeSelectedIds(config, 'missing')).toBeNull()
  expect(treeSelectedIds(config, '')).toEqual([])
  expect(treeSelectedIds(config, ['design'])).toBeNull()
}

for (const locale of ['en', 'zh-CN'])
  test(`${locale} tree details use exact single-selection values and portable bound text`, async () => {
    const { editor, graph, pageId } = componentTemplateFixture(['tree-details'], locale)
    try {
      const nodes = [...graph.getAllNodes()]
      const tree = nodes.find((node) => resolveTreeModule(node.interactiveProps?.module)?.ok)
      if (!tree) throw new Error('Expected reviewed Tree')
      const resolved = resolveTreeModule(tree.interactiveProps?.module)
      if (!resolved?.ok) throw new Error('Expected valid Tree config')
      expect(resolved.config).toMatchObject({
        presentation: 'tree',
        selectionMode: 'single',
        searchable: true,
        initialSelectedIds: ['design'],
        initialExpandedIds: ['project']
      })
      const binding = tree.bindings?.value
      if (binding?.kind !== 'ref' || !binding.stateId)
        throw new Error('Expected page-string selection')
      expect(graph.getNode(pageId)?.state).toEqual([
        expect.objectContaining({ id: binding.stateId, type: 'string', defaultValue: 'design' })
      ])
      expect(graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []).toEqual([])
      expect(moduleValueFields(tree)).toEqual([
        expect.objectContaining({ key: 'value', type: 'string', initialValue: 'design' })
      ])
      assertSingleSelection(resolved.config)
      expect(nodes.filter((node) => node.interactiveProps?.module)).toHaveLength(1)
      expect(nodes.filter((node) => node.type === 'FORM')).toHaveLength(0)
      const texts = assertDetailExpressions(nodes, binding.stateId)
      expect(nodes.some((node) => node.renderCondition === `${binding.stateId} === ""`)).toBe(true)
      const clear = nodes.find((node) => node.type === 'BUTTON')
      expect(clear?.events?.onClick).toEqual([
        expect.objectContaining({
          kind: 'setState',
          targetStateId: binding.stateId,
          valueExpr: '""'
        })
      ])
      await initCodec()
      const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
      expect(restored.getPages()[0].state).toEqual(graph.getNode(pageId)?.state)
      const restoredTree = [...restored.getAllNodes()].find(
        (node) => resolveTreeModule(node.interactiveProps?.module)?.ok
      )
      expect(restoredTree?.interactiveProps?.module).toEqual(tree.interactiveProps?.module)
      expect(restoredTree?.bindings).toEqual(tree.bindings)
      expect(
        [...restored.getAllNodes()]
          .filter((node) => node.bindings?.text)
          .map((node) => node.bindings)
      ).toEqual(texts.map((node) => node.bindings))
      for (const target of ['react', 'vue'] as const) {
        const result = compile({
          graph: restored,
          pageIds: [restored.getPages()[0].id],
          options: withDefaults({ target, router: 'none', devMode: false, sourceLocale: locale })
        })
        expect(result.warnings).toEqual([])
        typeCheckCompilerFiles(
          new Map(
            [...result.files].filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          ),
          target
        )
      }
    } finally {
      editor.dispose()
    }
  }, 35000)

test('tree detail copies retain independent category state through atomic undo', () => {
  const { editor, graph, pageId } = componentTemplateFixture([])
  try {
    const first = createComponentTemplate(editor, 'tree-details', 'zh-CN', { parentId: pageId })
    const second = createComponentTemplate(editor, 'tree-details', 'en', { parentId: pageId })
    expect(first.stateNames).toHaveLength(1)
    expect(second.stateNames.some((name) => first.stateNames.includes(name))).toBe(false)
    editor.undo.undo()
    expect(second.nodeIds.every((id) => !graph.getNode(id))).toBe(true)
    expect(graph.getNode(first.rootId)).toBeDefined()
    expect(graph.getNode(pageId)?.state).toHaveLength(1)
    editor.undo.redo()
    expect(graph.getNode(second.rootId)).toBeDefined()
    expect(graph.getNode(pageId)?.state).toHaveLength(2)
  } finally {
    editor.dispose()
  }
})
