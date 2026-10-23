import { describe, expect, test } from 'bun:test'

import { reactive } from 'vue'

import {
  emptyShaderPresetLibrary,
  MAX_PERSONAL_SHADER_PRESETS,
  readShaderPresetLibrary,
  savePersonalShaderPreset,
  type ShaderPresetLibrary
} from '@/app/editor/shaders/preset-library'

function pixels(scale = 12) {
  return { components: [{ type: 'Pixelate', props: { scale } }] }
}
function save(library: ShaderPresetLibrary, name: string, scale = 12) {
  const result = savePersonalShaderPreset(library, name, pixels(scale))
  if (!result.ok) throw new Error(`Preset save failed: ${result.reason}`)
  return result
}

describe('personal Shader presets', () => {
  test('roundtrips a versioned data-only library and trims names', () => {
    const saved = save(emptyShaderPresetLibrary(), '  My pixels  ')
    expect(readShaderPresetLibrary(JSON.stringify(saved.library))).toEqual(saved.library)
    expect(saved.library.entries[0].name).toBe('My pixels')
    expect(saved.library.entries[0].preset).toEqual(pixels())
    expect(saved.id).toMatch(/^[a-f0-9]{16}$/)
  })

  test('rejects malformed, unknown-version, duplicate and oversized persisted libraries', () => {
    const saved = save(emptyShaderPresetLibrary(), 'Pixels').library
    for (const text of [
      '{broken',
      JSON.stringify({ ...saved, version: 2 }),
      JSON.stringify({ ...saved, entries: [...saved.entries, saved.entries[0]] }),
      JSON.stringify({ ...saved, entries: [{ ...saved.entries[0], canvas: {} }] }),
      JSON.stringify(saved) + ' '.repeat(65_536)
    ])
      expect(readShaderPresetLibrary(text)).toEqual(emptyShaderPresetLibrary())
  })

  test('rejects unsupported props, runtime objects, non-finite values and out-of-range filters', () => {
    const library = emptyShaderPresetLibrary()
    const invalid = [
      pixels(Number.NaN),
      pixels(Number.POSITIVE_INFINITY),
      pixels(0),
      pixels(201),
      { components: [{ type: 'Pixelate', props: { scale: 12, texture: {} } }] },
      { components: [{ type: 'Pixelate', props: { scale: () => 12 } }] },
      { components: [{ type: 'Background', props: { scale: 12 } }] },
      { components: [{ type: 'Twirl', props: { intensity: -6 } }] },
      { components: [{ type: 'Saturation', props: { intensity: 4 } }] }
    ]
    for (const preset of invalid)
      expect(savePersonalShaderPreset(library, 'Invalid', preset)).toEqual({
        ok: false,
        reason: 'invalid'
      })
    for (const name of ['', ' '.repeat(3), 'x'.repeat(49), 'bad\u0000name'])
      expect(savePersonalShaderPreset(library, name, pixels())).toEqual({
        ok: false,
        reason: 'invalid'
      })
    expect(library.entries).toHaveLength(0)
  })

  test('same-name saves retain identity and clone both the preset and prior library', () => {
    const source = pixels(12)
    const first = savePersonalShaderPreset(emptyShaderPresetLibrary(), 'Pixels', source)
    if (!first.ok) throw new Error('First preset save failed')
    source.components[0].props.scale = 99
    expect(first.library.entries[0].preset).toEqual(pixels(12))
    const before = structuredClone(first.library)
    const second = save(first.library, 'Pixels', 24)
    expect(second.id).toBe(first.id)
    expect(second.library.entries).toHaveLength(1)
    expect(second.library.entries[0].preset).toEqual(pixels(24))
    expect(first.library).toEqual(before)
    expect(second.library.entries[0]).not.toBe(first.library.entries[0])
    const third = save(second.library, 'Other', 32)
    expect(third.library.entries[0]).not.toBe(second.library.entries[0])
    expect(third.library.entries[0].preset).not.toBe(second.library.entries[0].preset)
  })

  test('accepts reactive inspector data and returns a detached library', () => {
    const library = reactive(save(emptyShaderPresetLibrary(), 'First', 12).library)
    const preset = reactive(pixels(24))
    const saved = savePersonalShaderPreset(library, 'Second', preset)
    if (!saved.ok) throw new Error('Reactive preset save failed')
    expect(() => structuredClone(saved.library)).not.toThrow()
    preset.components[0].props.scale = 40
    expect(saved.library.entries[1].preset).toEqual(pixels(24))
    expect(library.entries).toHaveLength(1)
    expect(saved.library.entries[0]).not.toBe(library.entries[0])
  })

  test('caps new entries at 24 while allowing an existing name to update', () => {
    let library = emptyShaderPresetLibrary()
    for (let index = 0; index < MAX_PERSONAL_SHADER_PRESETS; index++)
      library = save(library, `Preset ${index}`).library
    const before = structuredClone(library)
    expect(savePersonalShaderPreset(library, 'Overflow', pixels())).toEqual({
      ok: false,
      reason: 'full'
    })
    const updated = save(library, 'Preset 0', 40)
    expect(updated.library.entries).toHaveLength(24)
    expect(updated.id).toBe(library.entries[0].id)
    expect(library).toEqual(before)
  })
})
