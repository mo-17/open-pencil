import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import {
  AVATAR_MODULE_DEFINITION,
  BADGE_MODULE_DEFINITION,
  TIMELINE_MODULE_DEFINITION,
  TIMELINE_ITEM_FIELDS
} from '@open-pencil/core/plugins'

import { feedbackPropertyVisible } from '@/app/lowcode/feedback-controls/properties'
import { localizedAppPluginModulePropertyText } from '@/app/plugins/localization'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test('display inspector fields and enum choices have Chinese copy, and modes preserve inactive settings', () => {
  const fields = [
    ...AVATAR_MODULE_DEFINITION.fields,
    ...BADGE_MODULE_DEFINITION.fields,
    ...TIMELINE_MODULE_DEFINITION.fields,
    ...TIMELINE_ITEM_FIELDS
  ]
  for (const field of fields) {
    expect(
      localizedAppPluginModulePropertyText(field.i18nLabelKey, 'zh-CN'),
      field.i18nLabelKey
    ).toBeTruthy()
    for (const value of field.options ?? [])
      expect(
        localizedAppPluginModulePropertyText(`${field.i18nLabelKey}:${value}`, 'zh-CN')
      ).toBeTruthy()
  }
  expect(feedbackPropertyVisible('open-pencil.badge', 'count', { mode: 'dot', count: 128 })).toBe(
    false
  )
  expect(feedbackPropertyVisible('open-pencil.badge', 'count', { mode: 'count', count: 128 })).toBe(
    true
  )
  expect(feedbackPropertyVisible('open-pencil.avatar', 'borderRadius', { shape: 'circle' })).toBe(
    false
  )
  expect(feedbackPropertyVisible('external.avatar', 'borderRadius', { shape: 'circle' })).toBe(true)
})

for (const locale of ['en', 'zh-CN'])
  test(`${locale}: display examples retain configuration through fig and both generated projects typecheck`, async () => {
    await initCodec()
    const fixture = componentTemplateFixture(['avatar', 'badge', 'dot-badge', 'timeline'], locale)
    try {
      const modules = [...fixture.graph.getAllNodes()].filter(
        (node) => node.interactiveProps?.module
      )
      expect(modules).toHaveLength(4)
      expect(modules.every((node) => node.type === 'FRAME')).toBe(true)
      const restored = await parseFigFile((await exportFigFile(fixture.graph)).slice().buffer)
      const restoredModules = [...restored.getAllNodes()].filter(
        (node) => node.interactiveProps?.module
      )
      const records = (nodes: typeof modules) =>
        nodes
          .map((node) => JSON.stringify({ name: node.name, props: node.interactiveProps }))
          .sort()
      expect(records(restoredModules)).toEqual(records(modules))
      for (const target of ['react', 'vue'] as const) {
        const result = compile({
          graph: restored,
          pageIds: [restored.getPages()[0].id],
          options: withDefaults({ target, router: 'none', lang: locale, devMode: false })
        })
        expect(result.warnings).toEqual([])
        const sources = new Map<string, string>()
        for (const [path, bytes] of result.files)
          if (typeof bytes === 'string') sources.set(path, bytes)
        expect(() => typeCheckCompilerFiles(sources, target)).not.toThrow()
      }
    } finally {
      fixture.editor.dispose()
    }
  }, 35_000)
