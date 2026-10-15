import { expect, test } from 'bun:test'

import * as avatar from '#core/plugins/avatar'

import { expectModuleInstance } from '#tests/helpers/assert'

test('Avatar produces independent strict FRAME config and readable Unicode initials', () => {
  const first = avatar.createAvatarModuleInstance(),
    second = avatar.createAvatarModuleInstance()
  first.config.name = 'Changed'
  expect(second.config.name).toBe('Alex Morgan')
  expect(avatar.avatarFallbackText({ name: 'Alex Morgan', fallbackText: '' })).toBe('AM')
  expect(avatar.avatarFallbackText({ name: '张小明', fallbackText: '' })).toBe('张小')
  expect(avatar.avatarFallbackText({ name: '张小明', fallbackText: '我' })).toBe('我')
  expect(avatar.avatarFallbackText({ name: '😀Smile', fallbackText: '' })).toBe('😀S')
  expect(
    expectModuleInstance(avatar.createAvatarModuleFrameOverrides().interactiveProps?.module)
      .pluginId
  ).toBe('open-pencil.avatar')
})
test('Avatar rejects URL authority, unknown config, versions and invalid geometry', () => {
  const instance = avatar.createAvatarModuleInstance()
  for (const patch of [
    { size: 23 },
    { size: 257 },
    { fontSize: Number.NaN },
    { fontSize: 97 },
    { borderWidth: -1 },
    { borderWidth: 9 },
    { name: '' },
    { fallbackText: 'x'.repeat(9) },
    { shape: 'pill' },
    { imageFit: 'tile' },
    { imageUrl: 'https://example.com/a.png' },
    { imageAsset: 'src/assets/evil.png' },
    { textColor: 'url(https://example.com)' },
    { size: '64' }
  ])
    expect(() => avatar.createAvatarModuleInstance(patch)).toThrow()
  expect(avatar.resolveAvatarModule({ ...instance, configVersion: 2 })?.ok).toBe(false)
  expect(avatar.resolveAvatarModule(null)).toBeNull()
  expect(avatar.resolveAvatarModule({ ...instance, moduleType: 'badge' })).toBeNull()
  const { name: _name, ...missing } = instance.config
  expect(avatar.resolveAvatarModule({ ...instance, config: missing })?.ok).toBe(false)
})
test('Avatar accepts only shared offline raster formats, not SVG or arbitrary URL bytes', () => {
  expect(
    avatar.avatarSupportsImageBytes(
      new TextEncoder().encode('<svg><image href="https://example.com"/></svg>')
    )
  ).toBe(false)
  expect(avatar.avatarSupportsImageBytes(new TextEncoder().encode('https://example.com'))).toBe(
    false
  )
})
