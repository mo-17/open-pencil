import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import {
  TOOLTIP_MODULE_DEFINITION,
  SKELETON_MODULE_DEFINITION,
  EMPTY_STATE_MODULE_DEFINITION
} from '@open-pencil/core/plugins'

import {
  feedbackPropertyVisible,
  feedbackControlHint
} from '@/app/lowcode/feedback-controls/properties'
import { localizedAppPluginModulePropertyText } from '@/app/plugins/localization'

import { expectDefined } from '#tests/helpers/assert'
import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

const modules = [
  TOOLTIP_MODULE_DEFINITION,
  SKELETON_MODULE_DEFINITION,
  EMPTY_STATE_MODULE_DEFINITION
]
test('foundation inspector labels and choices are translated; hidden settings are only a projection', () => {
  for (const module of modules) {
    expect(feedbackControlHint(module.pluginId, 'en')).toBeTruthy()
    expect(feedbackControlHint(module.pluginId, 'zh-CN')).toBeTruthy()
    for (const field of module.fields) {
      expect(
        localizedAppPluginModulePropertyText(expectDefined(field.i18nLabelKey), 'zh-CN'),
        field.i18nLabelKey
      ).toBeTruthy()
      for (const value of field.options ?? [])
        expect(
          localizedAppPluginModulePropertyText(`${field.i18nLabelKey}:${value}`, 'zh-CN')
        ).toBeTruthy()
    }
  }
  const settings = { variant: 'circle', rows: 8, lastLineWidth: 40, showLabel: false }
  expect(feedbackPropertyVisible('open-pencil.skeleton', 'rows', settings)).toBe(false)
  expect(feedbackPropertyVisible('open-pencil.skeleton', 'fontSize', settings)).toBe(false)
  expect(
    feedbackPropertyVisible('open-pencil.skeleton', 'rows', { ...settings, variant: 'text' })
  ).toBe(true)
  expect(settings).toEqual({ variant: 'circle', rows: 8, lastLineWidth: 40, showLabel: false })
  expect(
    feedbackPropertyVisible('open-pencil.empty-state', 'iconSize', { illustration: 'none' })
  ).toBe(false)
  expect(feedbackPropertyVisible('external.skeleton', 'rows', settings)).toBe(true)
})
for (const lang of ['en', 'zh-CN'])
  test(`${lang}: foundation templates survive fig readback and emit typed React/Vue projects`, async () => {
    await initCodec()
    const fixture = componentTemplateFixture(
      ['tooltip', 'skeleton', 'empty-state', 'empty-search'],
      lang
    )
    try {
      const source = [...fixture.graph.getAllNodes()].filter((n) => n.interactiveProps?.module)
      const readback = await parseFigFile((await exportFigFile(fixture.graph)).slice().buffer)
      const restored = [...readback.getAllNodes()].filter((n) => n.interactiveProps?.module)
      expect(restored).toHaveLength(4)
      const records = (nodes: typeof source) =>
        nodes
          .map((n) => JSON.stringify({ type: n.type, name: n.name, props: n.interactiveProps }))
          .sort()
      expect(source.every((n) => n.type === 'FRAME')).toBe(true)
      expect(records(restored)).toEqual(records(source))
      for (const target of ['react', 'vue'] as const) {
        const result = compile({
          graph: readback,
          pageIds: [readback.getPages()[0].id],
          options: withDefaults({ target, router: 'none', sourceLocale: lang, devMode: false })
        })
        expect(result.warnings).toEqual([])
        const files = new Map<string, string>()
        for (const [path, value] of result.files)
          if (typeof value === 'string') files.set(path, value)
        expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
      }
    } finally {
      fixture.editor.dispose()
    }
  }, 35_000)
