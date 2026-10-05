import { describe, expect, test } from 'bun:test'

import {
  cloneGeneratedEffectSpec,
  GENERATED_EFFECT_PRESETS,
  parseGeneratedEffectSpec,
  SceneGraph,
  validateGeneratedEffectSpec
} from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'
import { generatedEffect } from '#tests/helpers/generated-effect'

describe('generated-effect schema and graph semantics', () => {
  test('accepts every allowlisted preset and returns isolated canonical snapshots', () => {
    for (const preset of GENERATED_EFFECT_PRESETS) {
      const input = generatedEffect(preset)
      const parsed = parseGeneratedEffectSpec(input)
      const cloned = cloneGeneratedEffectSpec(parsed)
      expect(parsed).toEqual(input)
      expect(parsed).not.toBe(input)
      expect(cloned).toEqual(parsed)
      expect(cloned).not.toBe(parsed)
      expect(cloned.params).not.toBe(parsed.params)
    }
  })

  test('rejects future versions, unknown shader/code fields, non-finite data, and caps', () => {
    const cases: unknown[] = [
      { ...generatedEffect(), version: 2 },
      { ...generatedEffect(), shader: 'fn main() {}' },
      { ...generatedEffect(), code: 'alert(1)' },
      {
        ...generatedEffect(),
        uniforms: {
          ...generatedEffect().uniforms,
          time: { ...generatedEffect().uniforms.time, frequencyHz: 13 }
        }
      },
      { ...generatedEffect(), opacity: Number.NaN },
      {
        ...generatedEffect('particles'),
        params: { ...generatedEffect('particles').params, count: 65 }
      },
      {
        ...generatedEffect(),
        budget: { ...generatedEffect().budget, maxRasterPixels: 262_145 }
      }
    ]
    for (const value of cases) expect(validateGeneratedEffectSpec(value).success).toBe(false)
  })

  test('rejects symbols, custom prototypes, and cyclic data before traversal', () => {
    const symbolValue = generatedEffect()
    Reflect.set(symbolValue, Symbol('source'), 'forbidden')
    expect(validateGeneratedEffectSpec(symbolValue).success).toBe(false)

    const customPrototype = Object.create({ inherited: true })
    Object.assign(customPrototype, generatedEffect())
    expect(validateGeneratedEffectSpec(customPrototype).success).toBe(false)

    const cyclic = generatedEffect()
    Reflect.set(cyclic, 'cycle', cyclic)
    expect(validateGeneratedEffectSpec(cyclic).success).toBe(false)
  })

  test('cloneTree and instance sync preserve isolated specs and explicit clears', () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'default page')
    const component = graph.createNode('COMPONENT', page.id, {
      generatedEffect: generatedEffect('shimmer')
    })
    const instance = graph.createInstance(component.id, page.id)
    const clone = graph.cloneTree(component.id, page.id)

    expect(instance?.generatedEffect).toEqual(component.generatedEffect)
    expect(instance?.generatedEffect).not.toBe(component.generatedEffect)
    expect(clone?.generatedEffect).toEqual(component.generatedEffect)
    expect(clone?.generatedEffect).not.toBe(component.generatedEffect)

    if (!instance) throw new Error('Expected instance')
    graph.updateNode(instance.id, {
      overrides: { ...instance.overrides, generatedEffect: null }
    })
    graph.clearNodeFields(instance.id, ['generatedEffect'])
    graph.updateNode(component.id, { generatedEffect: generatedEffect('noise') })
    graph.syncInstances(component.id)
    expect(graph.getNode(instance.id)?.generatedEffect).toBeUndefined()
  })
})
