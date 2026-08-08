import { describe, expect, test } from 'bun:test'

import { DEFAULT_DOCS_NODE_OPTIONS, docsNodeOptions } from '../.vitepress/build/environment'

describe('documentation build Node options', () => {
  test('supplies the bounded docs heap when no options are configured', () => {
    expect(docsNodeOptions(undefined)).toBe(DEFAULT_DOCS_NODE_OPTIONS)
    expect(docsNodeOptions('   ')).toBe(DEFAULT_DOCS_NODE_OPTIONS)
  })

  test('preserves unrelated options and adds the docs heap', () => {
    expect(docsNodeOptions('--trace-warnings --max-semi-space-size=128')).toBe(
      `--trace-warnings --max-semi-space-size=128 ${DEFAULT_DOCS_NODE_OPTIONS}`
    )
  })

  test('respects an explicit max-old-space-size override', () => {
    expect(docsNodeOptions('--max-old-space-size=6144 --trace-warnings')).toBe(
      '--max-old-space-size=6144 --trace-warnings'
    )
    expect(docsNodeOptions('--max_old_space_size 6144')).toBe('--max_old_space_size 6144')
  })
})
