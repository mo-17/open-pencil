import { describe, expect, test } from 'bun:test'

import { createCrossPartitionLinkFilter } from '../.vitepress/build/partition-links'

const docsRoot = '/docs'
const localePrefixes = ['de', 'fr', 'zh-cn']
const existingFiles = new Set([
  '/docs/index.md',
  '/docs/reference/scene-graph.md',
  '/docs/de/index.md',
  '/docs/de/guide/intro.md',
  '/docs/fr/guide/intro.md',
  '/docs/zh-cn/guide/intro.md'
])
const fileExists = (path: string) => existingFiles.has(path)

describe('partitioned documentation dead links', () => {
  test('ignores only existing documents owned by another partition', () => {
    const filter = createCrossPartitionLinkFilter({
      docsRoot,
      partition: 'de',
      localePrefixes,
      fileExists
    })

    expect(filter('/reference/scene-graph', '/docs/de/guide/intro.md')).toBe(true)
    expect(filter('/fr/guide/intro#details', '/docs/de/guide/intro.md')).toBe(true)
    expect(filter('/zh-cn/guide/intro', '/docs/de/guide/intro.md')).toBe(true)
    expect(filter('/reference/missing', '/docs/de/guide/intro.md')).toBe(false)
  })

  test('leaves same-partition, external, asset, and traversal links checked normally', () => {
    const filter = createCrossPartitionLinkFilter({
      docsRoot,
      partition: 'de',
      localePrefixes,
      fileExists
    })

    expect(filter('/de/guide/intro', '/docs/de/guide/intro.md')).toBe(false)
    expect(filter('https://example.test/reference', '/docs/de/guide/intro.md')).toBe(false)
    expect(filter('/favicon.png', '/docs/de/guide/intro.md')).toBe(false)
    expect(filter('/de/../reference/scene-graph', '/docs/de/guide/intro.md')).toBe(false)
  })

  test('does not hide links into archived locale partitions', () => {
    const filter = createCrossPartitionLinkFilter({
      docsRoot,
      partition: 'zh-cn',
      localePrefixes,
      enabledPartitions: ['en', 'zh-cn'],
      fileExists
    })

    expect(filter('/reference/scene-graph', '/docs/zh-cn/guide/intro.md')).toBe(true)
    expect(filter('/de/guide/intro', '/docs/zh-cn/guide/intro.md')).toBe(false)
    expect(filter('/fr/guide/intro', '/docs/zh-cn/guide/intro.md')).toBe(false)
  })
})
