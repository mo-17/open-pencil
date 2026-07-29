import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseGeneratedEffectSpec } from '@open-pencil/scene-graph'

import {
  createGeneratedEffect,
  updateNodeGeneratedEffect,
  withGeneratedEffectPreset
} from '@/app/properties/generated-effect'

import { expectDefined } from '#tests/helpers/assert'

describe('generated-effect property mutations', () => {
  test('creates strict safe defaults and switches preset without loosening shared bounds', () => {
    const original = createGeneratedEffect('noise')
    const switched = withGeneratedEffectPreset(original, 'particles')
    expect(parseGeneratedEffectSpec(original)).toEqual(original)
    expect(parseGeneratedEffectSpec(switched)).toEqual(switched)
    expect(original.params.preset).toBe('noise')
    expect(switched.params.preset).toBe('particles')
    expect(switched.uniforms).toEqual(original.uniforms)
    expect(switched.budget).toEqual(original.budget)
    expect(switched.params).not.toBe(original.params)
  })

  test('updates and clears with one undo entry and explicit instance tombstones', () => {
    const editor = createEditor({ skipInitialGraphSetup: true })
    const page = expectDefined(editor.graph.getPages()[0], 'default page')
    const component = editor.graph.createNode('COMPONENT', page.id, {
      generatedEffect: createGeneratedEffect('shimmer')
    })
    const instance = editor.graph.createInstance(component.id, page.id)
    if (!instance) throw new Error('Expected instance')
    const custom = createGeneratedEffect('scanlines')

    expect(updateNodeGeneratedEffect(editor, instance.id, custom)).toBe(true)
    expect(editor.graph.getNode(instance.id)?.overrides.generatedEffect).toEqual(custom)
    expect(editor.undo.undo()).toBe('Update generated effect')
    expect(editor.graph.getNode(instance.id)?.generatedEffect).toEqual(component.generatedEffect)

    updateNodeGeneratedEffect(editor, instance.id, undefined, 'Remove generated effect')
    expect(editor.graph.getNode(instance.id)?.generatedEffect).toBeUndefined()
    expect(editor.graph.getNode(instance.id)?.overrides.generatedEffect).toBeNull()
    editor.graph.updateNode(component.id, { generatedEffect: createGeneratedEffect('noise') })
    editor.graph.syncInstances(component.id)
    expect(editor.graph.getNode(instance.id)?.generatedEffect).toBeUndefined()
  })
})
