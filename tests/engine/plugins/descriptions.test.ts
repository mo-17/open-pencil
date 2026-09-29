import { expect, test } from 'bun:test'

import {
  createDescriptionsModuleInstance,
  createDescriptionsModuleFrameOverrides,
  resolveDescriptionsModule,
  DESCRIPTIONS_MODULE_DEFAULT_CONFIG,
  descriptionsColumns,
  descriptionsCellMetrics
} from '#core/plugins/descriptions'

test('Descriptions accepts bounded literal pairs and exact versioned display config', () => {
  const instance = createDescriptionsModuleInstance()
  expect(resolveDescriptionsModule(instance)?.ok).toBe(true)
  expect(resolveDescriptionsModule({ ...instance, configVersion: 2 })?.ok).toBe(false)
  for (const invalid of [
    { label: '' },
    { label: ' ' },
    { columns: 0 },
    { columns: 4 },
    { columns: 1.5 },
    { layout: 'grid' },
    { density: 'auto' },
    { bordered: 1 },
    { fontSize: 9 },
    { borderRadius: 25 },
    { textColor: 'url(https://example.com)' },
    { backgroundColor: '#fff' },
    { onClick: 'run()' },
    { dataSource: 'backend' },
    { items: [] },
    {
      items: Array.from({ length: 25 }, (_, index) => ({
        id: `i${index}`,
        label: 'Label',
        value: ''
      }))
    }
  ])
    expect(() => createDescriptionsModuleInstance(invalid)).toThrow()
  for (const invalid of [
    { id: 'a', label: ' ', value: '' },
    { id: 'a', label: 'x'.repeat(121), value: '' },
    { id: 'a', label: 'Label', value: 'x'.repeat(1001) },
    { id: 'a.b', label: 'Label', value: '' },
    { id: 'a', label: 'Label', value: 10 },
    { id: 'a', label: 'Label', value: '', href: 'https://example.com' }
  ])
    expect(() => createDescriptionsModuleInstance({ items: [invalid] })).toThrow()
  expect(() =>
    createDescriptionsModuleInstance({
      items: [
        { id: 'a', label: 'A', value: '' },
        { id: 'a', label: 'B', value: '' }
      ]
    })
  ).toThrow()
  expect(
    createDescriptionsModuleInstance({
      items: [{ id: 'x', label: '<b>标签</b>', value: '<img src=x onerror=alert(1)>\n中文' }]
    }).config.items
  ).toEqual([{ id: 'x', label: '<b>标签</b>', value: '<img src=x onerror=alert(1)>\n中文' }])
  expect(createDescriptionsModuleFrameOverrides().type).toBeUndefined()
  expect(createDescriptionsModuleFrameOverrides().fills).toEqual([])
})
test('Descriptions rejects accessors, sparse items, and independent default mutation', () => {
  let reads = 0
  const malicious = Object.defineProperty({ id: 'a', label: 'A' }, 'value', {
    enumerable: true,
    get() {
      reads++
      return 'secret'
    }
  })
  expect(() => createDescriptionsModuleInstance({ items: [malicious] })).toThrow()
  const sparse: unknown[] = []
  sparse.length = 2
  expect(() => createDescriptionsModuleInstance({ items: sparse })).toThrow()
  expect(reads).toBe(0)
  const first = createDescriptionsModuleInstance(),
    second = createDescriptionsModuleInstance()
  ;(first.config.items as { value: string }[])[0].value = 'Changed'
  expect(second.config).toEqual(DESCRIPTIONS_MODULE_DEFAULT_CONFIG)
})
test('Descriptions reduces columns at actual container widths and keeps narrow text in bounds', () => {
  expect([100, 199, 399, 400, 599, 600, 900].map((width) => descriptionsColumns(width, 3))).toEqual(
    [1, 1, 1, 2, 2, 3, 3]
  )
  expect(descriptionsColumns(900, 2)).toBe(2)
  const horizontal = descriptionsCellMetrics(100, { ...DESCRIPTIONS_MODULE_DEFAULT_CONFIG })
  expect(horizontal).toEqual({
    padding: 8,
    labelWidth: 42,
    valueWidth: 58,
    labelTextWidth: 26,
    valueTextWidth: 42
  })
  const vertical = descriptionsCellMetrics(100, {
    ...DESCRIPTIONS_MODULE_DEFAULT_CONFIG,
    layout: 'vertical'
  })
  expect(vertical.labelTextWidth).toBe(84)
  expect(vertical.valueTextWidth).toBe(84)
})
