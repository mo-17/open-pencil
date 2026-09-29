import { expect, test } from 'bun:test'

import {
  createEmptyStateModuleInstance,
  createEmptyStateModuleFrameOverrides,
  EMPTY_STATE_MODULE_DEFAULT_CONFIG,
  emptyStateGeometry,
  resolveEmptyStateModule
} from '#core/plugins/empty-state'

test('empty state accepts only bounded inert text, reviewed illustrations and exact versioned config', () => {
  const instance = createEmptyStateModuleInstance()
  expect(resolveEmptyStateModule(instance)?.ok).toBe(true)
  expect(resolveEmptyStateModule({ ...instance, configVersion: 2 })?.ok).toBe(false)
  for (const invalid of [
    { title: '' },
    { title: '   ' },
    { title: 'x'.repeat(161) },
    { description: 'x'.repeat(1201) },
    { illustration: 'https://example.com/picture.png' },
    { alignment: 'right' },
    { iconSize: 23 },
    { iconSize: 129 },
    { fontSize: 9 },
    { gap: 3 },
    { gap: Infinity },
    { padding: 65 },
    { borderRadius: -1 },
    { descriptionColor: 'url(https://example.com)' },
    { textColor: '#fff' },
    { onClick: 'run()' },
    { dataSource: 'backend' }
  ])
    expect(() => createEmptyStateModuleInstance(invalid)).toThrow()
  const literal = createEmptyStateModuleInstance({
    title: '<img src=x onerror=alert(1)>',
    description: '中文\nEnglish',
    illustration: 'none'
  })
  expect(literal.config.title).toBe('<img src=x onerror=alert(1)>')
  expect(createEmptyStateModuleFrameOverrides().type).not.toBeDefined()
  expect(createEmptyStateModuleFrameOverrides().fills).toEqual([])
})

test('empty state rejects accessors without executing them and keeps default instances independent', () => {
  let reads = 0
  const invalid = Object.defineProperty({}, 'title', {
    enumerable: true,
    get() {
      reads++
      return 'Unsafe'
    }
  })
  expect(() => createEmptyStateModuleInstance(invalid)).toThrow()
  expect(reads).toBe(0)
  const first = createEmptyStateModuleInstance(),
    second = createEmptyStateModuleInstance()
  first.config.title = 'Changed'
  expect(second.config).toEqual(EMPTY_STATE_MODULE_DEFAULT_CONFIG)
})

test('empty state geometry centers short content and keeps long copy reachable in narrow frames', () => {
  const config = { ...EMPTY_STATE_MODULE_DEFAULT_CONFIG }
  const center = emptyStateGeometry(360, 240, config, 27, 42)
  expect(center.icon.x + center.icon.width / 2).toBe(180)
  expect(center.icon.y).toBe((240 - center.contentHeight) / 2)
  expect(center.description.y - center.title.y - center.title.height).toBe(config.gap)
  const left = emptyStateGeometry(
    100,
    80,
    { ...config, alignment: 'left', padding: 64, iconSize: 128 },
    90,
    160
  )
  expect(left.icon.width).toBe(50)
  expect(left.icon.x).toBe(25)
  expect(left.icon.y).toBe(25)
  expect(left.title.width).toBe(50)
  const textOnly = emptyStateGeometry(
    360,
    240,
    { ...config, illustration: 'none', description: '' },
    27,
    0
  )
  expect(textOnly.icon.width).toBe(0)
  expect(textOnly.title.y).toBe((240 - 27) / 2)
  expect(textOnly.contentHeight).toBe(27)
})
