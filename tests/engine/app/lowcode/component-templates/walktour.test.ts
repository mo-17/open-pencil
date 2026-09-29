import { expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { resolveWalktourModule } from '@open-pencil/core/plugins'

import {
  compileComponentTemplates,
  componentTemplateFixture
} from '#tests/helpers/compiler/components/templates/fixture'

test('Walktour recipe retains real editable target cards and authored positions through FIG readback', async () => {
  const f = componentTemplateFixture(['walktour'], 'zh-CN')
  try {
    const node = [...f.graph.getAllNodes()].find(
      (item) => item.interactiveProps?.module?.moduleType === 'walktour'
    )
    if (!node) throw new Error('Missing tour')
    const module = resolveWalktourModule(node.interactiveProps?.module)
    if (!module?.ok) throw new Error('Invalid tour')
    const children = f.graph.getChildren(node.id)
    expect(children.map((child) => child.name)).toEqual(
      module.config.steps.map((step) => step.targetChildName)
    )
    expect(children.map((child) => [child.x, child.y, child.width, child.height])).toEqual([
      [12, 60, 296, 64],
      [12, 140, 296, 64],
      [12, 220, 296, 64]
    ])
    expect(
      children.every((child) => child.visible && f.graph.getChildren(child.id).length === 2)
    ).toBe(true)
    expect(f.results[0].stateNames).toEqual([])
    expect([...f.graph.getAllNodes()].some((item) => item.type === 'FORM')).toBe(false)
    expect(module.config.triggerLabel).toBe('开始引导')
    await initCodec()
    const restored = await parseFigFile((await exportFigFile(f.graph)).slice().buffer)
    const reopened = [...restored.getAllNodes()].find((item) => item.name === node.name)
    if (!reopened) throw new Error('Missing restored tour')
    expect(reopened.interactiveProps).toEqual(node.interactiveProps)
    expect(
      restored.getChildren(reopened.id).map((child) => [child.name, child.x, child.y])
    ).toEqual(children.map((child) => [child.name, child.x, child.y]))
  } finally {
    f.editor.dispose()
  }
})
for (const target of ['react', 'vue'] as const)
  test(`${target}: Walktour recipe compiles target cards without warnings or business state`, () => {
    const output = compileComponentTemplates(target, ['walktour'], 'zh-CN')
    expect(output.warnings).toEqual([])
    const text = [...output.files.values()].join('\n')
    expect(text).toContain('OpenPencilWalktour')
    for (const name of ['概览卡片', '偏好卡片', '完成卡片']) expect(text).toContain(name)
  })
