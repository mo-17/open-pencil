import * as v from 'valibot'

import { shaderPresetSchema, type ShaderPreset } from '@open-pencil/scene-graph'
import { randomHex } from '@open-pencil/scene-graph/random'
import { contentShaderFilter } from '@open-pencil/vue'

export const SHADER_PRESET_LIBRARY_KEY = 'open-pencil:content-shader-presets:v1'
export const MAX_PERSONAL_SHADER_PRESETS = 24
const nameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1),
  v.maxLength(48),
  v.check((value) => !/\p{Cc}/u.test(value))
)
const presetSchema = v.pipe(
  shaderPresetSchema,
  v.check((preset) => {
    const filter = contentShaderFilter(preset)
    const value = filter && preset.components[0]?.props?.[filter.prop]
    return Boolean(
      filter &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= filter.min &&
      value <= filter.max
    )
  })
)
const entrySchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^[a-f0-9]{16}$/)),
  name: nameSchema,
  preset: presetSchema
})
const librarySchema = v.strictObject({
  version: v.literal(1),
  entries: v.pipe(
    v.array(entrySchema),
    v.maxLength(MAX_PERSONAL_SHADER_PRESETS),
    v.check((entries) =>
      entries.every(
        (entry, index) =>
          entries.findIndex((other) => other.id === entry.id || other.name === entry.name) === index
      )
    )
  )
})
export type ShaderPresetLibrary = v.InferOutput<typeof librarySchema>
export type PersonalShaderPreset = ShaderPresetLibrary['entries'][number]

export function emptyShaderPresetLibrary(): ShaderPresetLibrary {
  return { version: 1, entries: [] }
}
export function readShaderPresetLibrary(text: string): ShaderPresetLibrary {
  if (text.length > 65_536) return emptyShaderPresetLibrary()
  const result = v.safeParse(v.pipe(v.string(), v.parseJson(), librarySchema), text)
  return result.success ? result.output : emptyShaderPresetLibrary()
}
export function copyPersonalShaderPreset(preset: ShaderPreset): ShaderPreset | null {
  const result = v.safeParse(presetSchema, preset)
  return result.success ? result.output : null
}
export function savePersonalShaderPreset(
  library: ShaderPresetLibrary,
  name: string,
  preset: ShaderPreset
):
  | { ok: true; library: ShaderPresetLibrary; id: string }
  | { ok: false; reason: 'invalid' | 'full' } {
  const checkedName = v.safeParse(nameSchema, name)
  const checkedPreset = v.safeParse(presetSchema, preset)
  const checkedLibrary = v.safeParse(librarySchema, library)
  if (!checkedName.success || !checkedPreset.success || !checkedLibrary.success)
    return { ok: false, reason: 'invalid' }
  const entries = checkedLibrary.output.entries
  const existing = entries.find((entry) => entry.name === checkedName.output)
  if (!existing && entries.length === MAX_PERSONAL_SHADER_PRESETS)
    return { ok: false, reason: 'full' }
  const entry = {
    id: existing?.id ?? randomHex(8),
    name: checkedName.output,
    preset: structuredClone(checkedPreset.output)
  }
  return {
    ok: true,
    id: entry.id,
    library: {
      version: 1,
      entries: existing
        ? entries.map((item) => (item.id === entry.id ? entry : item))
        : [...entries, entry]
    }
  }
}
