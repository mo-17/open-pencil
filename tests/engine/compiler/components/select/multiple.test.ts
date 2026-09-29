import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { planValidatedFormValueBindings, validateInteractiveProps } from '@open-pencil/lowcode'

import {
  selectMultipleMode,
  toggleSelectDefault,
  editSelectOptions
} from '@/app/lowcode/controls/select-options'

import {
  selectMultipleFixture,
  selectMultipleGraph
} from '#tests/helpers/compiler/components/select/multiple'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

describe('SELECT multiple values', () => {
  test('uses array binding and does not insert a synthetic empty option', () => {
    const { graph, pageId } = selectMultipleGraph()
    const form = collectTree(graph, pageId).children[0] as IRElement
    const ir = form.children[0] as IRElement
    expect(ir.controlled?.write.targetType).toBe('array')
    expect(ir.attrs.multiple).toBe(true)
    expect(ir.children).toHaveLength(4)
    expect(ir.validation).toBeDefined()
  })
  test('form binding repair proposes an array, and type validation rejects a scalar multi-value', () => {
    const { graph, form, select } = selectMultipleGraph()
    graph.updateNode(select.id, {
      bindings: {},
      interactiveProps: { ...select.interactiveProps, value: ['a', 'b'] }
    })
    const plan = planValidatedFormValueBindings(graph, form.id)
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error('Invalid plan')
    expect(plan.data.bindings[0].state).toMatchObject({ type: 'array', defaultValue: ['a', 'b'] })
    expect(
      validateInteractiveProps('SELECT', { multiple: true, value: 'a' }).length
    ).toBeGreaterThan(0)
    expect(validateInteractiveProps('SELECT', { multiple: true, value: ['a', 'b'] })).toEqual([])
    expect(
      validateInteractiveProps('SELECT', { multiple: false, value: ['a'] }).length
    ).toBeGreaterThan(0)
  })
  test('renaming or removing options keeps all literal selected values consistent', () => {
    const props = {
      multiple: true,
      value: ['a', 'b'],
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' }
      ]
    }
    const renamed = editSelectOptions(props, { kind: 'update', index: 0, patch: { value: 'c' } })
    expect(renamed.value).toEqual(['c', 'b'])
    expect(editSelectOptions(renamed, { kind: 'remove', index: 1 }).value).toEqual(['c'])
  })
  test.each(['react', 'vue'] as const)(
    '%s array validation counts values rather than ID characters',
    (target) => {
      const result = selectMultipleFixture(target)
      const path = target === 'react' ? 'src/_lowcode_validation.tsx' : 'src/lowcode-validation.ts'
      const source = result.files.find(([name]) => name === path)?.[1]
      if (typeof source !== 'string') throw new Error('Missing validation runtime')
      const name = target === 'react' ? 'validateValue' : '__opValidateValue'
      const start = source.indexOf('export function ' + name)
      const end = source.indexOf('\nexport ', start + 1)
      const fn = source
        .slice(start, end === -1 ? undefined : end)
        .replace('export function', 'function')
      const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(fn)
      const validate = new Function(js + '; return ' + name)() as (
        value: unknown,
        rules: { minLength?: number; maxLength?: number; required?: boolean }
      ) => string | null
      expect(validate(['long-business-id'], { minLength: 2 })).toBe('Must be at least 2 items')
      expect(validate(['', 'a'], { minLength: 2, maxLength: 2 })).toBeNull()
      expect(validate([''], { required: true, minLength: 2 })).toBe('Must be at least 2 items')
      expect(validate([], { required: true })).toBe('This field is required')
      expect(validate('ab', { minLength: 3 })).toBe('Must be at least 3 characters')
    }
  )
  test.each(['react', 'vue', 'shadcn'] as const)(
    '%s generated arrays and validation typecheck',
    (variant) => {
      const target = variant === 'vue' ? 'vue' : 'react'
      const result = selectMultipleFixture(target, variant === 'shadcn')
      expect(result.warnings).toEqual([])
      typeCheckCompilerFiles(new Map(result.files), target)
    },
    35_000
  )
  test('literal design mode changes preserve an empty business value and remove renamed values atomically', () => {
    expect(
      selectMultipleMode({ value: '', options: [{ value: '', label: 'All' }] }, true).value
    ).toEqual([''])
    expect(
      selectMultipleMode({ value: '', placeholder: 'Choose', options: ['A'] }, true).value
    ).toEqual([])
    expect(toggleSelectDefault({ multiple: true, value: [] }, '')).toEqual({
      multiple: true,
      value: ['']
    })
    expect(selectMultipleMode({ multiple: true, value: ['a', 'b'] }, false).value).toBe('a')
  })
})
