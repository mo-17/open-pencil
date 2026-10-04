import { expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { validateInteractiveProps } from '@open-pencil/lowcode'

import { getComponentTemplates } from '@/app/lowcode/component-templates'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

for (const locale of ['en', 'zh-CN'])
  test(`${locale}: input recipes use editable native nodes and independent string bindings through FIG`, async () => {
    const fixture = componentTemplateFixture(['autocomplete', 'time-picker'], locale)
    try {
      const catalog = getComponentTemplates(locale)
      expect(catalog).toHaveLength(66)
      for (const id of ['autocomplete', 'time-picker']) {
        expect(catalog.find((item) => item.id === id)?.requiredModules).toEqual([])
      }
      const inputs = [...fixture.graph.getAllNodes()].filter((node) => node.type === 'INPUT')
      expect(inputs).toHaveLength(2)
      for (const input of inputs) {
        expect(
          validateInteractiveProps(input.type, input.interactiveProps).filter(
            (issue) => issue.severity === 'error'
          )
        ).toEqual([])
        const binding = input.bindings?.value
        if (binding?.kind !== 'ref') throw new Error('Expected page string binding')
        expect(
          fixture.graph.getPages()[0].state?.find((state) => state.id === binding.stateId)?.type
        ).toBe('string')
      }
      expect(inputs[0].interactiveProps.suggestions).toEqual(
        locale === 'en' ? ['Xiamen', 'Quanzhou', 'Fuzhou'] : ['厦门', '泉州', '福州']
      )
      expect(inputs[1].interactiveProps).toMatchObject({
        inputType: 'time',
        min: '08:00',
        max: '18:00',
        step: 900
      })
      await initCodec()
      const restored = await parseFigFile((await exportFigFile(fixture.graph)).slice().buffer)
      expect(restored.getPages()[0].state).toEqual(fixture.graph.getPages()[0].state)
      for (const input of inputs) {
        const reopened = [...restored.getAllNodes()].find(
          (node) => node.name === input.name && node.type === 'INPUT'
        )
        expect(reopened?.interactiveProps).toEqual(input.interactiveProps)
        expect(reopened?.bindings).toEqual(input.bindings)
      }
    } finally {
      fixture.editor.dispose()
    }
  })
