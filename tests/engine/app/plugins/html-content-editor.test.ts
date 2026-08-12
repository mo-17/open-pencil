import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(import.meta.dir, '../../../../src/components/properties/Lowcode/HtmlContentEditor.vue'),
  'utf8'
)

function iframeMarkup(): string {
  const markup = source.match(/<iframe[\s\S]*?\/>/)?.[0]
  if (!markup) throw new Error('Expected the HTML content editor iframe')
  return markup
}

describe('HTML module property editor', () => {
  test('uses the shared bounded sandbox document builder for synchronous srcdoc preview', () => {
    expect(source).toContain('HTML_MODULE_LIMITS.html')
    expect(source).toContain("buildHTMLSandboxDocument(overLimit.value ? '' : source.value)")
    expect(source).toContain(':maxlength="maximumLength"')
    expect(source).toContain('@input="updateSource"')
  })

  test('keeps the preview iframe inert and referrer-free', () => {
    const iframe = iframeMarkup()

    expect(iframe).toContain('sandbox=""')
    expect(iframe).toContain('referrerpolicy="no-referrer"')
    expect(iframe).toContain(':aria-label="panels.lowcodeHtmlPreview"')
    expect(iframe).toContain('pointer-events-none')
    expect(iframe).not.toContain('allow-scripts')
    expect(iframe).not.toContain('allow-same-origin')
  })

  test('commits on blur or the explicit platform shortcut and watches external values', () => {
    expect(source).toContain('@blur="commit"')
    expect(source).toContain('@keydown="commitShortcut"')
    expect(source).toContain('event.metaKey && !event.ctrlKey')
    expect(source).toContain('() => modelValue')
  })
})
