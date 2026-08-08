import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  HTML_MODULE_LIMITS,
  HTML_MODULE_SANDBOX_CSP,
  buildHtmlSandboxDocument,
  createHtmlModuleInstance,
  resolveHtmlModule
} from '@open-pencil/core/plugins'

describe('built-in HTML plugin', () => {
  test('registers an opt-in compatible module with a bounded editable source', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule('open-pencil.html', 'html')
    const instance = createHtmlModuleInstance({ html: '<main><h1>Edited HTML</h1></main>' })
    const resolved = resolveHtmlModule(instance)

    expect(definition?.name).toBe('</> HTML')
    expect(definition?.defaultSize).toEqual({ width: 640, height: 400 })
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected HTML module to resolve')
    expect(resolved.config.html).toContain('Edited HTML')
  })

  test('builds CSP-first srcdoc while preserving authored static markup and CSS', () => {
    const html = '<style>strong{color:red}</style><strong>Visible</strong><script>x()</script>'
    const document = buildHtmlSandboxDocument(html)

    expect(document.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(
      true
    )
    expect(document).toContain(HTML_MODULE_SANDBOX_CSP)
    expect(document).toEndWith(html)
    expect(HTML_MODULE_SANDBOX_CSP).toContain("default-src 'none'")
    expect(HTML_MODULE_SANDBOX_CSP).toContain("script-src 'none'")
    expect(HTML_MODULE_SANDBOX_CSP).toContain("connect-src 'none'")
    expect(HTML_MODULE_SANDBOX_CSP).not.toContain('https:')
  })

  test('rejects unknown fields, wrong types, unsupported versions, and oversized source', () => {
    expect(() => createHtmlModuleInstance({ html: '<p>x</p>', script: 'x()' })).toThrow(
      'exactly html'
    )
    expect(() => createHtmlModuleInstance({ html: 7 })).toThrow('at most')
    expect(() =>
      createHtmlModuleInstance({ html: 'x'.repeat(HTML_MODULE_LIMITS.html + 1) })
    ).toThrow(`at most ${HTML_MODULE_LIMITS.html}`)
    expect(() => buildHtmlSandboxDocument('x'.repeat(HTML_MODULE_LIMITS.html + 1))).toThrow(
      `at most ${HTML_MODULE_LIMITS.html}`
    )
    expect(
      resolveHtmlModule({
        version: 1,
        pluginId: 'open-pencil.html',
        moduleType: 'html',
        configVersion: 2,
        config: { html: '' }
      })
    ).toEqual({ ok: false, reason: 'unsupported HTML config version 2' })
  })
})
