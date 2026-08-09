import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(
    import.meta.dir,
    '../../../../src/components/properties/Lowcode/MultilineModuleTextEditor.vue'
  ),
  'utf8'
)

describe('multiline module text editor', () => {
  test('bounds source text and reports a host-formatted character count', () => {
    expect(source).toContain(':maxlength="maxLength"')
    expect(source).toContain('draft.value.length > maxLength')
    expect(source).toContain('countLabel(draft.value.length, maxLength)')
    expect(source).toContain('aria-live="polite"')
  })

  test('commits once across native change and blur and tracks external values', () => {
    expect(source).toContain('@change="commit"')
    expect(source).toContain('@blur="commit"')
    expect(source).toContain('draft.value === lastCommitted.value')
    expect(source).toContain('lastCommitted.value = draft.value')
    expect(source).toContain('() => modelValue')
    expect(source).toContain("emit('commit', draft.value)")
  })

  test('treats Markdown and code as plain textarea content', () => {
    expect(source).toContain('<textarea')
    expect(source).not.toContain('v-html')
    expect(source).not.toContain('innerHTML')
    expect(source).not.toContain('contenteditable')
  })
})
