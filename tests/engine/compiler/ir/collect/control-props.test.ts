import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { LOWCODE_INPUT_TYPES } from '@open-pencil/lowcode'

import {
  controlFoundationGraph,
  controlFoundationFixture
} from '#tests/helpers/compiler/components/controls'
import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

describe('native control property contracts', () => {
  test('emits reviewed types and constraints without changing string-bound number state', () => {
    const { graph, pageId, amount } = controlFoundationGraph()
    const tree = collectTree(graph, pageId)
    const root = tree.children[0] as IRElement
    const input = root.children.find(
      (entry) => 'sourceId' in entry && entry.sourceId === amount.id
    ) as IRElement
    expect(input.attrs).toMatchObject({
      type: 'number',
      inputMode: 'decimal',
      autoComplete: 'off',
      min: 0,
      max: 10,
      step: 0.5,
      'aria-label': 'Amount'
    })
    expect(input.controlled?.write.targetType).toBe('string')
    expect(tree.warnings).toEqual([])
    for (const inputType of LOWCODE_INPUT_TYPES) {
      graph.updateNode(amount.id, { interactiveProps: { inputType } })
      const next = (collectTree(graph, pageId).children[0] as IRElement).children[0] as IRElement
      expect(next.attrs.type).toBe(inputType)
      expect(next.controlled?.write.targetType).toBe('string')
    }
  })

  test('drops malformed native properties instead of widening the attribute surface', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('INPUT', pageId, {
      interactiveProps: {
        inputType: 'number',
        value: 'NaN',
        min: '0',
        max: 10,
        step: 0,
        inputMode: 'javascript',
        autoComplete: 'secret-token',
        disabled: 'true',
        readOnly: 'true',
        ariaLabel: '  ',
        minLength: -1,
        maxLength: 2.5,
        onload: 'alert(1)'
      }
    })
    const tree = collectTree(graph, pageId)
    const attrs = (tree.children[0] as IRElement).attrs
    expect(attrs).toEqual({ type: 'number', max: 10 })
    expect(tree.warnings.map((warning) => warning.code)).toContain('interactive-props-step-type')
    expect(tree.warnings.map((warning) => warning.code)).toContain('interactive-props-value-number')
    expect(tree.warnings.map((warning) => warning.code)).toContain(
      'interactive-props-ariaLabel-type'
    )
  })

  test('immutable fields keep their values without blocking form validation, and dynamic options take precedence', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(pageId, {
      state: [
        { id: 'value', name: 'draft', type: 'string', defaultValue: '' },
        {
          id: 'choices',
          name: 'choices',
          type: 'array',
          defaultValue: [{ id: 'a', label: 'Dynamic' }]
        }
      ]
    })
    const form = graph.createNode('FORM', pageId)
    for (const props of [{ disabled: true }, { readOnly: true }]) {
      graph.createNode('INPUT', form.id, {
        bindings: { value: { kind: 'ref', stateId: 'value' } },
        interactiveProps: { ...props, validation: { required: true } }
      })
    }
    const select = graph.createNode('SELECT', form.id, {
      interactiveProps: {
        options: [{ label: 'Static should not leak', value: 'static' }],
        optionsSource: {
          kind: 'ref',
          stateId: 'choices',
          itemName: 'choice',
          valueExpr: 'choice.id',
          labelExpr: 'choice.label'
        }
      }
    })
    const tree = collectTree(graph, pageId)
    const formIR = tree.children[0] as IRElement
    for (const field of formIR.children.slice(0, 2) as IRElement[]) {
      expect(field.controlled?.write.targetType).toBe('string')
      expect(field.validation).toBeUndefined()
    }
    expect(formIR.formValidationKeys ?? []).toEqual([])
    const selectIR = formIR.children.find(
      (entry) => 'sourceId' in entry && entry.sourceId === select.id
    ) as IRElement
    expect(selectIR.children).toHaveLength(1)
    expect(selectIR.children[0].kind).toBe('list')
    expect(JSON.stringify(selectIR)).not.toContain('Static should not leak')
  })

  test('keeps static labels separate from values, supports legacy strings and disables actual group inputs', () => {
    const { graph, pageId } = controlFoundationGraph()
    const root = collectTree(graph, pageId).children[0] as IRElement
    const select = root.children[1] as IRElement
    const options = select.children as IRElement[]
    expect(options[0].attrs.value).toBe('standard')
    expect(options[0].children[0]).toEqual({ kind: 'text', value: 'Standard delivery' })
    expect(options[2].attrs.disabled).toBe(true)
    const defaultSelect = root.children[2] as IRElement
    expect(defaultSelect.attrs.defaultValue).toBe('saved')
    expect((defaultSelect.children[0] as IRElement).attrs.value).toBe('Legacy')
    const group = root.children[7] as IRElement
    expect(group.attrs).toMatchObject({
      'aria-label': 'Disabled delivery group',
      role: 'radiogroup',
      'aria-disabled': 'true'
    })
    for (const label of group.children as IRElement[])
      expect((label.children[0] as IRElement).attrs.disabled).toBe(true)
  })

  test.each(['react', 'vue'] as const)(
    '%s emits real controls with supported native attributes',
    (target) => {
      const output = controlFoundationFixture(target)
      const source = output.files
        .filter(([path]) => /\.(tsx|vue)$/.test(path))
        .map(([, value]) => value)
        .join('\n')
      expect(source).toContain('aria-label="Read only date"')
      expect(source).toContain('Standard delivery')
      expect(source).toContain('value="unavailable" disabled')
      expect(source).toContain(target === 'react' ? 'readOnly' : 'readonly')
    }
  )
})
