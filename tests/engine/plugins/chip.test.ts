import { expect, test } from 'bun:test'

import { createChipModuleInstance, resolveChipModule } from '#core/plugins/chip'

test('chip owns a strict bounded versioned data contract', () => {
  const module = createChipModuleInstance({
    label: '已发布',
    selectable: true,
    initialSelected: true
  })
  expect(resolveChipModule(module)?.ok).toBe(true)
  expect(resolveChipModule({ ...module, configVersion: 2 })?.ok).toBe(false)
  expect(
    resolveChipModule({ ...module, config: { ...module.config, script: 'alert(1)' } })?.ok
  ).toBe(false)
  for (const invalid of [
    { label: '' },
    { label: 'x'.repeat(121) },
    { fontSize: Infinity },
    { fontSize: 9 },
    { borderRadius: -1 },
    { borderRadius: 33 },
    { disabled: 'yes' },
    { selectable: 1 },
    { initialSelected: null },
    { variant: 'url(script)' },
    { color: 'red' },
    { color: 'url(https://example.com)' },
    { filledTextColor: '#fff' },
    { deleteLabel: '' },
    { removedLabel: '' }
  ])
    expect(() => createChipModuleInstance(invalid)).toThrow()
})

test('chip preserves plain text without invoking accessors or sharing mutable configs', () => {
  const first = createChipModuleInstance({ label: '<img src=x onerror=alert(1)>' })
  const second = createChipModuleInstance()
  first.config.label = 'Changed'
  expect(second.config.label).toBe('Status label')
  let reads = 0
  const config = { ...second.config }
  Object.defineProperty(config, 'label', {
    enumerable: true,
    get() {
      reads++
      return 'Unsafe'
    }
  })
  expect(resolveChipModule({ ...second, config })?.ok).toBe(false)
  expect(reads).toBe(0)
})
