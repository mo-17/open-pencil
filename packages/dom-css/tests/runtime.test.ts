import { describe, expect, it } from 'bun:test'

import {
  createCSSRuntime,
  createHeadlessCSSRuntime,
  exportHTMLBundle,
  serializeHTML
} from '../src/index'
import { cardDocument, TEST_COLORS } from './helpers'

describe('@open-pencil/dom-css runtime', () => {
  it('serializes DesignDOM as HTML', () => {
    expect(serializeHTML(cardDocument)).toContain('<article class="card">')
    expect(serializeHTML(cardDocument)).toContain('OpenPencil')
  })

  it('serializes inline styles as Tailwind classes when requested', () => {
    const html = serializeHTML(
      {
        type: 'document',
        children: [
          {
            type: 'element',
            tagName: 'section',
            attrs: { class: 'card' },
            inlineStyle: {
              display: 'flex',
              padding: '16px',
              gap: '8px',
              'background-color': 'white'
            },
            children: [{ type: 'text', text: 'OpenPencil' }]
          }
        ]
      },
      { style: 'tailwind' }
    )

    expect(html).toBe('<section class="card flex p-4 gap-2 bg-white">OpenPencil</section>')
  })

  it('exports standalone HTML documents when requested', async () => {
    const bundle = await exportHTMLBundle(cardDocument, { html: 'standalone' })
    const html = String(bundle.files[0]?.content)

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('data-open-pencil-html="standalone"')
    expect(html).toContain('OpenPencil')
    expect(html).not.toContain('@tailwindcss/browser@4')
  })

  it('precompiles Tailwind CSS for standalone Tailwind HTML', async () => {
    const bundle = await exportHTMLBundle(cardDocument, { html: 'standalone', style: 'tailwind' })
    const html = String(bundle.files[0]?.content)

    expect(html).toContain('<style>')
    expect(html).not.toContain('@tailwindcss/browser@4')
  })

  it('uses the headless runtime outside browser contexts', () => {
    const runtime = createCSSRuntime()

    expect(runtime.kind).toBe('headless')
    expect(runtime.serializeHTML(cardDocument)).toContain('OpenPencil')
  })

  it('parses HTML with inline styles', () => {
    const runtime = createHeadlessCSSRuntime()
    const document = runtime.parseHTML(
      '<section class="card" style="width: 320px; color: rgb(17, 24, 39)">OpenPencil</section>'
    )
    const section = document.children[0]

    expect(section?.type).toBe('element')
    if (section?.type !== 'element') return
    expect(section.tagName).toBe('section')
    expect(section.attrs.class).toBe('card')
    expect(section.inlineStyle?.width).toBe('320px')
    expect(section.inlineStyle?.color).toBe('rgb(17, 24, 39)')
    expect(section.children[0]).toEqual({ type: 'text', text: 'OpenPencil' })
  })

  it('drops active inline resource values while preserving ordinary declarations', () => {
    const runtime = createHeadlessCSSRuntime()
    const document = runtime.parseHTML(
      '<section style="background-image: url(\'data:image/svg+xml;utf8,<svg></svg>\'); width: 320px">OpenPencil</section>'
    )
    const section = document.children[0]

    expect(section?.type).toBe('element')
    if (section?.type !== 'element') return
    expect(section.inlineStyle?.['background-image']).toBeUndefined()
    expect(section.inlineStyle?.width).toBe('320px')
  })

  it('removes active markup and dangerous URLs while preserving safe import resources', () => {
    const runtime = createHeadlessCSSRuntime()
    const embeddedImage = 'data:image/png;base64,AAAA'
    const document = runtime.parseHTML(`
      <main id="hero" class="card" onclick="globalThis.pwned = 1"
        style="color: red; background-image: url(https://attacker.invalid/bg); width: 320px">
        <script>globalThis.pwned = 2</script>
        <iframe srcdoc="<script>globalThis.pwned = 3</script>"></iframe>
        <object data="https://attacker.invalid/object"></object>
        <img alt="Remote" src="https://attacker.invalid/pixel" onerror="globalThis.pwned = 4">
        <img alt="Embedded" src="${embeddedImage}">
        <a href="javascript:globalThis.pwned = 5" autofocus>Label</a>
        <security-probe>custom element</security-probe>
      </main>
    `)
    const html = serializeHTML(document)

    expect(html).toContain(
      '<main id="hero" class="card" style="color: red; background-image: url(https://attacker.invalid/bg); width: 320px">'
    )
    expect(html).toContain('<img alt="Remote" src="https://attacker.invalid/pixel">')
    expect(html).toContain(`<img alt="Embedded" src="${embeddedImage}">`)
    expect(html).toContain('<a>Label</a>')
    expect(html).not.toMatch(/script|iframe|object|security-probe|on(?:click|error)|javascript:/i)
  })

  it('sanitizes caller-built DesignDOM during serialization', () => {
    const html = serializeHTML({
      type: 'document',
      children: [
        {
          type: 'element',
          tagName: 'iframe',
          attrs: { srcdoc: '<script>globalThis.pwned = 1</script>' },
          children: []
        },
        {
          type: 'element',
          tagName: 'section',
          attrs: {
            class: 'card',
            onclick: 'globalThis.pwned = 2',
            style: 'color: red; background: url(javascript:globalThis.pwned=3)'
          },
          inlineStyle: {
            color: 'red',
            background: 'url(javascript:globalThis.pwned=3)'
          },
          children: [{ type: 'text', text: 'Safe content' }]
        }
      ]
    })

    expect(html).toBe('<section class="card" style="color: red">Safe content</section>')
  })

  it('rejects direct and CSS-escaped external resource syntax before style computation', async () => {
    const runtime = createHeadlessCSSRuntime()
    const document = runtime.parseHTML('<section class="card">OpenPencil</section>')

    await expect(
      runtime.computeStyles(
        document,
        '.card { background-image: url(https://attacker.invalid/a); }'
      )
    ).rejects.toThrow('rejected active or external CSS resource syntax')
    await expect(
      runtime.computeStyles(
        document,
        String.raw`.card { background-image: u\72l(https://attacker.invalid/b); }`
      )
    ).rejects.toThrow('rejected active or external CSS resource syntax')
    await expect(
      runtime.computeStyles(document, String.raw`@\69mport "https://attacker.invalid/c";`)
    ).rejects.toThrow('rejected active or external CSS resource syntax')
  })

  it('computes selector specificity, inheritance, and shorthands', async () => {
    const runtime = createHeadlessCSSRuntime()
    const parsed = runtime.parseHTML(`
      <article id="hero" class="card featured">
        <header><h1 class="title">OpenPencil</h1></header>
      </article>
    `)
    const document = await runtime.computeStyles(
      parsed,
      `
        article { color: ${TEST_COLORS.slate900}; padding: 8px 16px; }
        .card { width: 300px; color: ${TEST_COLORS.slate700}; }
        article.card > header { gap: 12px; }
        .card .title { font-size: 24px; }
        #hero { width: 320px; background: white; }
      `
    )
    const card = document.children[0]

    expect(card?.type).toBe('element')
    if (card?.type !== 'element') return
    expect(card.computedStyle?.width).toBe('320px')
    expect(card.computedStyle?.color).toBe(TEST_COLORS.slate700)
    expect(card.computedStyle?.['padding-right']).toBe('16px')

    const header = card.children.find((child) => child.type === 'element')
    expect(header?.type).toBe('element')
    if (header?.type !== 'element') return
    expect(header.computedStyle?.gap).toBe('12px')
    expect(header.computedStyle?.color).toBe(TEST_COLORS.slate700)
  })
})
