import { isEqual } from 'es-toolkit'

import type { ShaderPreset } from '@open-pencil/scene-graph'

/** Native input filters verified against the locked shaders registry. No runtime handles persist. */
export const CONTENT_SHADER_FILTERS = [
  { type: 'Pixelate', prop: 'scale', min: 1, max: 200, step: 1, value: 24 },
  { type: 'Twirl', prop: 'intensity', min: -5, max: 5, step: 0.1, value: 1 },
  { type: 'Saturation', prop: 'intensity', min: 0, max: 3, step: 0.1, value: 0 }
] as const

export type ContentShaderFilter = (typeof CONTENT_SHADER_FILTERS)[number]

export function contentShaderPreset(filter: ContentShaderFilter): ShaderPreset {
  return { components: [{ type: filter.type, props: { [filter.prop]: filter.value } }] }
}

/** Custom stacks and extra parameters stay custom; selecting a filter explicitly replaces them. */
export function contentShaderFilter(preset: ShaderPreset): ContentShaderFilter | undefined {
  return CONTENT_SHADER_FILTERS.find((filter) => {
    const component = preset.components.at(0)
    const value = component?.props?.[filter.prop]
    return (
      typeof value === 'number' &&
      isEqual(preset, {
        components: [{ type: filter.type, props: { [filter.prop]: value } }]
      })
    )
  })
}
