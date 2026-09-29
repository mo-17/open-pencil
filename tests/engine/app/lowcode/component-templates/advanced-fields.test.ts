import { expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { validateInteractiveProps } from '@open-pencil/lowcode'

import { getComponentTemplates } from '@/app/lowcode/component-templates'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

const IDS = ['date-time-picker', 'number-input', 'password-input'] as const

for (const locale of ['en', 'zh-CN']) {
  test(`${locale}: advanced input recipes preserve editable contracts and keep password defaults empty through FIG`, async () => {
    const fixture = componentTemplateFixture([...IDS], locale)
    try {
      const catalog = getComponentTemplates(locale)
      expect(catalog).toHaveLength(62)
      expect(catalog.filter((item) => item.kind === 'basic')).toHaveLength(54)
      expect(catalog.filter((item) => item.kind === 'combination')).toHaveLength(8)
      expect(catalog.slice(45, 48).map((item) => item.id)).toEqual([...IDS])
      for (const id of IDS)
        expect(catalog.find((item) => item.id === id)?.requiredModules).toEqual([])
      const inputs = [...fixture.graph.getAllNodes()].filter((node) => node.type === 'INPUT')
      expect(inputs).toHaveLength(3)
      for (const input of inputs) {
        expect(
          validateInteractiveProps('INPUT', input.interactiveProps).filter(
            (issue) => issue.severity === 'error'
          )
        ).toEqual([])
        const binding = input.bindings?.value
        if (binding?.kind !== 'ref') throw new Error('Expected page-state binding')
        const state = fixture.graph.getPages()[0].state?.find((item) => item.id === binding.stateId)
        expect(state?.type).toBe('string')
        if (input.interactiveProps.inputType === 'password') {
          expect(state?.defaultValue).toBe('')
          expect(input.interactiveProps.value).toBeUndefined()
          expect(input.interactiveProps.showPasswordToggle).toBe(true)
          const summaries = [...fixture.graph.getAllNodes()].filter((node) =>
            JSON.stringify(node.bindings?.text ?? {}).includes(binding.stateId)
          )
          expect(summaries).toEqual([])
        }
      }
      expect(inputs[0].interactiveProps).toMatchObject({ inputType: 'datetime-local', step: 900 })
      expect(inputs[1].interactiveProps).toMatchObject({
        inputType: 'number',
        showStepper: true,
        stepperPlacement: 'sides',
        min: 0,
        max: 99,
        step: 1
      })
      await initCodec()
      const restored = await parseFigFile((await exportFigFile(fixture.graph)).slice().buffer)
      expect(restored.getPages()[0].state).toEqual(fixture.graph.getPages()[0].state)
      for (const input of inputs) {
        const reopened = [...restored.getAllNodes()].find(
          (node) => node.type === 'INPUT' && node.name === input.name
        )
        expect(reopened?.interactiveProps).toEqual(input.interactiveProps)
        expect(reopened?.bindings).toEqual(input.bindings)
      }
    } finally {
      fixture.editor.dispose()
    }
  })
}
