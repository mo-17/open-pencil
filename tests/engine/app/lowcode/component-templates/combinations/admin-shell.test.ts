import { beforeAll, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { validateExpression } from '@open-pencil/lowcode'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'
import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

beforeAll(initCodec)

function authoredRows(graph: SceneGraph) {
  return [...graph.getAllNodes()]
    .filter((node) => node.id !== graph.rootId && node.type !== 'CANVAS')
    .map((node) => ({
      name: node.name,
      type: node.type,
      text: node.text,
      bindings: node.bindings,
      events: node.events,
      interactiveProps: node.interactiveProps,
      renderCondition: node.renderCondition,
      responsiveOverrides: node.responsiveOverrides,
      textAutoResize: node.textAutoResize,
      layoutMode: node.layoutMode,
      primaryAxisSizing: node.primaryAxisSizing,
      counterAxisSizing: node.counterAxisSizing
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

test('admin shell keeps navigation mounted and isolates section and preference states for each copy', () => {
  const fixture = componentTemplateFixture(['admin-shell', 'admin-shell'])
  try {
    const states = expectDefined(fixture.graph.getNode(fixture.pageId)?.state)
    expect(states).toHaveLength(4)
    expect(new Set(states.map((state) => state.name)).size).toBe(4)
    expect(states.filter((state) => state.defaultValue === 'overview')).toHaveLength(2)
    expect(states.filter((state) => state.type === 'boolean')).toHaveLength(2)
    const roots = fixture.results.map((result) =>
      expectDefined(fixture.graph.getNode(result.rootId))
    )
    for (const [index, root] of roots.entries()) {
      expect(root.layoutMode).toBe('VERTICAL')
      expect(root.width).toBe(860)
      const body = expectDefined(
        fixture.graph.getChildren(root.id).find((node) => node.name === 'Workspace layout')
      )
      expect(body.layoutMode).toBe('HORIZONTAL')
      expect(body.responsiveOverrides?.compact).toMatchObject({
        layoutMode: 'VERTICAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'FILL',
        minWidth: 0
      })
      const navigation = expectDefined(
        fixture.graph.getChildren(body.id).find((node) => node.name === 'Workspace navigation')
      )
      const buttons = fixture.graph
        .getChildren(navigation.id)
        .filter((node) => node.type === 'BUTTON')
      expect(buttons).toHaveLength(3)
      for (const button of buttons) {
        expect(button.renderCondition).toBeUndefined()
        expect(button.events?.onClick).toMatchObject([
          { kind: 'setState', targetStateId: `template${index + 1}_section` }
        ])
        const binding = button.bindings?.text
        if (binding?.kind !== 'expr')
          throw new Error('Navigation marker requires a text expression')
        expect(validateExpression(binding.expr ?? '').ok).toBe(true)
        expect(binding.expr).toContain(`template${index + 1}_section`)
        expect(binding.expr).toContain('Current')
      }
      const content = expectDefined(
        fixture.graph.getChildren(body.id).find((node) => node.name === 'Workspace content')
      )
      expect(content.responsiveOverrides?.compact).toMatchObject({
        counterAxisSizing: 'FILL',
        minWidth: 0,
        layoutGrow: 0
      })
      const panels = fixture.graph.getChildren(content.id).filter((node) => node.type === 'FRAME')
      expect(panels).toHaveLength(3)
      for (const panel of panels) {
        expect(validateExpression(panel.renderCondition ?? '').ok).toBe(true)
        expect(panel.renderCondition).toContain(`template${index + 1}_section`)
        expect(fixture.graph.getChildren(panel.id).length).toBeGreaterThan(1)
      }
      const notificationSwitch = expectDefined(
        panels
          .flatMap((panel) => fixture.graph.getChildren(panel.id))
          .find((node) => node.type === 'SWITCH')
      )
      expect(notificationSwitch.width).toBe(44)
      expect(notificationSwitch.height).toBe(24)
      expect(notificationSwitch.layoutAlignSelf).toBe('MIN')
      for (const breakpoint of ['compact', 'xl'] as const) {
        expect(notificationSwitch.responsiveOverrides?.[breakpoint]).toEqual({
          width: 44,
          minWidth: 0,
          counterAxisSizing: 'FIXED'
        })
      }
      expect(
        fixture.results[index].nodeIds
          .map((id) => expectDefined(fixture.graph.getNode(id)))
          .every((node) => !node.interactiveProps?.module)
      ).toBe(true)
    }
    const before = structuredClone(states)
    fixture.editor.undo.undo()
    expect(fixture.graph.getNode(roots[1].id)).toBeUndefined()
    expect(fixture.graph.getNode(fixture.pageId)?.state).toEqual(before.slice(0, 2))
    fixture.editor.undo.redo()
    expect(fixture.graph.getNode(fixture.pageId)?.state).toEqual(before)
  } finally {
    fixture.editor.dispose()
  }
})

test.each(['en', 'zh-CN'])(
  '%s admin shell preserves editable content, responsive layout and expressions through FIG readback',
  async (locale) => {
    const fixture = componentTemplateFixture(['admin-shell'], locale)
    try {
      const source = authoredRows(fixture.graph)
      const restored = await parseFigFile((await exportFigFile(fixture.graph)).slice().buffer)
      expect(authoredRows(restored)).toEqual(source)
      expect(restored.getPages()[0].state).toEqual(fixture.graph.getPages()[0].state)
      const notificationSwitch = expectDefined(
        [...restored.getAllNodes()].find((node) => node.type === 'SWITCH')
      )
      expect(notificationSwitch.width).toBe(44)
      expect(notificationSwitch.height).toBe(24)
      expect(notificationSwitch.layoutAlignSelf).toBe('MIN')
      for (const target of ['react', 'vue'] as const) {
        const result = compile({
          graph: restored,
          pageIds: [restored.getPages()[0].id],
          options: withDefaults({ target, router: 'none', devMode: false, sourceLocale: locale })
        })
        expect(result.warnings).toEqual([])
        expect(result.files.has(target === 'react' ? 'src/App.tsx' : 'src/App.vue')).toBe(true)
        const sourceFiles = [...result.files.values()].filter(
          (content): content is string => typeof content === 'string'
        )
        const switchMarkup = expectDefined(
          sourceFiles
            .flatMap((content) => content.split('\n'))
            .find((line) => line.includes('role="switch"'))
        )
        expect(switchMarkup).toContain('w-11')
        expect(switchMarkup).toContain('h-6')
        expect(switchMarkup).toContain('xl:min-w-0')
        expect(switchMarkup).toContain('max-xl:min-w-0')
        expect(switchMarkup).not.toContain('w-147')
      }
    } finally {
      fixture.editor.dispose()
    }
  }
)
