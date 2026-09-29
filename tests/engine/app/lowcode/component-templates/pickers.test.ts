import { expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { resolveDescriptionsModule } from '@open-pencil/core/plugins'
import { validateInteractiveProps } from '@open-pencil/lowcode'

import { getComponentTemplates } from '@/app/lowcode/component-templates'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

for (const locale of ['en', 'zh-CN'])
  test(`${locale}: picker and details templates preserve color bindings and editable static items through FIG`, async () => {
    const fixture = componentTemplateFixture(['color-picker', 'descriptions'], locale)
    try {
      const catalog = getComponentTemplates(locale)
      expect(catalog).toHaveLength(62)
      expect(catalog.filter((item) => item.kind === 'basic')).toHaveLength(54)
      expect(catalog.slice(48, 50).map((item) => item.id)).toEqual(['color-picker', 'descriptions'])
      const input = [...fixture.graph.getAllNodes()].find((node) => node.type === 'INPUT')
      if (!input) throw new Error('Missing color INPUT')
      expect(input.interactiveProps.inputType).toBe('color')
      expect(
        validateInteractiveProps('INPUT', input.interactiveProps).filter(
          (issue) => issue.severity === 'error'
        )
      ).toEqual([])
      const binding = input.bindings?.value
      if (binding?.kind !== 'ref') throw new Error('Missing color page-state binding')
      expect(
        fixture.graph.getPages()[0].state?.find((state) => state.id === binding.stateId)
      ).toMatchObject({ type: 'string', defaultValue: '#2563eb' })
      const details = [...fixture.graph.getAllNodes()].find(
        (node) => node.interactiveProps?.module?.moduleType === 'descriptions'
      )
      if (!details) throw new Error('Missing details module')
      const resolution = resolveDescriptionsModule(details.interactiveProps.module)
      expect(resolution?.ok).toBe(true)
      expect(details.bindings).toBeUndefined()
      await initCodec()
      const restored = await parseFigFile((await exportFigFile(fixture.graph)).slice().buffer)
      for (const original of [input, details]) {
        const reopened = [...restored.getAllNodes()].find(
          (node) =>
            node.name === original.name &&
            node.type === original.type &&
            node.interactiveProps?.module?.moduleType ===
              original.interactiveProps?.module?.moduleType
        )
        expect(reopened?.interactiveProps).toEqual(original.interactiveProps)
        expect(reopened?.bindings).toEqual(original.bindings)
      }
    } finally {
      fixture.editor.dispose()
    }
  })
