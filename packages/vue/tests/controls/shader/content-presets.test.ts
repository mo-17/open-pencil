import { describe, expect, test } from 'bun:test'

import {
  CONTENT_SHADER_FILTERS,
  contentShaderFilter,
  contentShaderPreset,
  loadShaderCatalog,
  setShaderEffectProp
} from '#vue/controls/shader'

describe('content filter shortcuts', () => {
  test('each shortcut uses an input filter and native parameter bounds from the installed library', async () => {
    const catalog = await loadShaderCatalog()
    for (const filter of CONTENT_SHADER_FILTERS) {
      const effect = catalog.find((effect) => effect.name === filter.type)
      expect(effect?.filter).toBe(true)
      expect(effect?.props.find((prop) => prop.key === filter.prop)).toMatchObject({
        kind: 'range',
        min: filter.min,
        max: filter.max,
        step: filter.step
      })
      expect(filter.value).toBeGreaterThanOrEqual(filter.min)
      expect(filter.value).toBeLessThanOrEqual(filter.max)
    }
  })

  test('editing and resetting produce independent data; custom stacks and options stay custom', () => {
    for (const filter of CONTENT_SHADER_FILTERS) {
      const preset = contentShaderPreset(filter)
      const changed = setShaderEffectProp(preset, 0, filter.prop, filter.max)
      expect(contentShaderFilter(changed)).toBe(filter)
      expect(preset.components[0]?.props?.[filter.prop]).toBe(filter.value)
      expect(contentShaderPreset(filter)).toEqual(preset)
      expect(contentShaderPreset(filter)).not.toBe(preset)
      expect(contentShaderFilter({ ...preset, structureVersion: 2 })).toBeUndefined()
      expect(
        contentShaderFilter({ components: [...preset.components, { type: 'Grayscale' }] })
      ).toBeUndefined()
      expect(contentShaderFilter(setShaderEffectProp(preset, 0, 'custom', 1))).toBeUndefined()
    }
  })
})
