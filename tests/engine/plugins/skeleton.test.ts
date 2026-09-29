import { expect, test } from 'bun:test'

import * as skeleton from '#core/plugins/skeleton'

test('Skeleton is independent bounded FRAME data, without request or progress authority', () => {
  const first = skeleton.createSkeletonModuleInstance(),
    second = skeleton.createSkeletonModuleInstance()
  first.config.label = 'Changed'
  expect(second.config.label).toBe('Loading content')
  expect(skeleton.resolveSkeletonModule(second)?.ok).toBe(true)
  expect(skeleton.createSkeletonModuleFrameOverrides().interactiveProps?.module?.moduleType).toBe(
    'skeleton'
  )
  expect(Object.keys(second.config)).not.toContain('value')
  expect(Object.keys(second.config)).not.toContain('url')
})
test('Skeleton rejects invalid envelopes, versions, executable fields and missing configuration', () => {
  const module = skeleton.createSkeletonModuleInstance()
  expect(skeleton.resolveSkeletonModule(null)).toBeNull()
  expect(skeleton.resolveSkeletonModule({ ...module, moduleType: 'progress' })).toBeNull()
  expect(skeleton.resolveSkeletonModule({ ...module, configVersion: 2 })?.ok).toBe(false)
  const { rows: _rows, ...missing } = module.config
  expect(skeleton.resolveSkeletonModule({ ...module, config: missing })?.ok).toBe(false)
  for (const patch of [
    { requestUrl: 'https://example.com' },
    { progress: 50 },
    { loading: true },
    { animation: 'shimmer' }
  ])
    expect(() => skeleton.createSkeletonModuleInstance(patch)).toThrow()
  let reads = 0
  const config = { ...module.config }
  Object.defineProperty(config, 'label', {
    enumerable: true,
    get() {
      reads++
      return 'Hidden'
    }
  })
  expect(skeleton.resolveSkeletonModule({ ...module, config })?.ok).toBe(false)
  expect(reads).toBe(0)
})
test('Skeleton bounds text rows, geometry, copy and colors without coercion', () => {
  for (const patch of [
    { rows: 0 },
    { rows: 13 },
    { rows: 1.5 },
    { rows: '3' },
    { gap: -1 },
    { gap: 33 },
    { lineHeight: 3 },
    { lineHeight: 49 },
    { lastLineWidth: 9 },
    { lastLineWidth: 101 },
    { fontSize: Number.NaN },
    { fontSize: 33 },
    { borderRadius: 49 },
    { variant: 'image' },
    { color: 'url(https://example.com)' },
    { backgroundColor: 'transparent' },
    { label: '' },
    { label: ' '.repeat(5) },
    { label: 'a'.repeat(161) },
    { showLabel: 'true' }
  ])
    expect(() => skeleton.createSkeletonModuleInstance(patch)).toThrow()
  for (const patch of [
    { rows: 1, gap: 0, lastLineWidth: 10 },
    { rows: 12, gap: 32, lastLineWidth: 100, lineHeight: 48 },
    { variant: 'circle', animation: 'none' }
  ])
    expect(skeleton.resolveSkeletonModule(skeleton.createSkeletonModuleInstance(patch))?.ok).toBe(
      true
    )
})
