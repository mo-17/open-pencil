import { describe, expect, test } from 'bun:test'

import {
  analyzeCustomCodeCspRisks,
  buildCustomCodePatch,
  draftFromCustomCode,
  hasIncompleteCustomCodeRows,
  hasUnsafeCustomCodeUrls
} from '@/app/lowcode/custom-code-panel-state'

describe('lowcode custom code panel state', () => {
  test('normalizes structured head metadata and custom css', () => {
    const patch = buildCustomCodePatch({
      meta: [
        { kind: 'name', key: ' viewport ', content: ' width=device-width, initial-scale=1 ' },
        { kind: 'property', key: '', content: 'ignored' }
      ],
      link: [
        {
          rel: ' preload ',
          href: ' /font.woff2 ',
          as: ' font ',
          type: ' font/woff2 ',
          media: ' all ',
          crossorigin: 'anonymous'
        },
        { rel: 'stylesheet', href: '' }
      ],
      stylesText: ' :root { color-scheme: light; } \n\n body { margin: 0; } ',
      customCss: ' .app-shell { scroll-behavior: smooth; } '
    })

    expect(patch).toEqual({
      lowcodeHeadMetadata: {
        meta: [{ kind: 'name', key: 'viewport', content: 'width=device-width, initial-scale=1' }],
        link: [
          {
            rel: 'preload',
            href: '/font.woff2',
            as: 'font',
            type: 'font/woff2',
            media: 'all',
            crossorigin: 'anonymous'
          }
        ],
        styles: [':root { color-scheme: light; }', 'body { margin: 0; }']
      },
      lowcodeCustomCss: '.app-shell { scroll-behavior: smooth; }'
    })
  })

  test('clears empty custom code instead of persisting empty containers', () => {
    expect(
      buildCustomCodePatch({
        meta: [],
        link: [],
        stylesText: '   ',
        customCss: ''
      })
    ).toEqual({
      lowcodeHeadMetadata: undefined,
      lowcodeCustomCss: undefined
    })
  })

  test('drops unsafe custom head link href protocols from panel patches', () => {
    const patch = buildCustomCodePatch({
      meta: [],
      link: [
        { rel: 'stylesheet', href: `java${'script'}:alert(1)` },
        { rel: 'preconnect', href: 'https://cdn.example.com' }
      ],
      stylesText: '',
      customCss: ''
    })

    expect(patch.lowcodeHeadMetadata?.link).toEqual([
      { rel: 'preconnect', href: 'https://cdn.example.com' }
    ])
  })

  test('drops unsafe custom CSS URL protocols from panel patches', () => {
    const unsafeCss = `.hero { background-image: url(${`java${'script'}:alert(1)`}); }`
    const draft = {
      meta: [],
      link: [],
      stylesText: '',
      customCss: unsafeCss
    }
    const patch = buildCustomCodePatch(draft)

    expect(hasUnsafeCustomCodeUrls(draft)).toBe(true)
    expect(patch.lowcodeCustomCss).toBeUndefined()
  })

  test('flags partially filled rows so the panel can keep them as local draft', () => {
    expect(
      hasIncompleteCustomCodeRows({
        meta: [{ kind: 'name', key: 'description', content: '' }],
        link: [],
        stylesText: '',
        customCss: ''
      })
    ).toBe(true)
    expect(
      hasIncompleteCustomCodeRows({
        meta: [],
        link: [{ rel: '', href: 'https://cdn.example/app.css' }],
        stylesText: '',
        customCss: ''
      })
    ).toBe(true)
  })

  test('hydrates panel draft from committed root fields', () => {
    expect(
      draftFromCustomCode(
        {
          meta: [{ kind: 'property', key: 'og:title', content: 'Launch' }],
          styles: ['.a { color: red; }', '.b { color: blue; }']
        },
        'body { margin: 0; }'
      )
    ).toEqual({
      meta: [{ kind: 'property', key: 'og:title', content: 'Launch' }],
      link: [],
      stylesText: '.a { color: red; }\n\n.b { color: blue; }',
      customCss: 'body { margin: 0; }'
    })
  })

  test('reports deploy CSP risks for external custom resources', () => {
    const risks = analyzeCustomCodeCspRisks({
      meta: [],
      link: [
        { rel: 'stylesheet', href: 'https://cdn.example/app.css' },
        { rel: 'preload', href: 'https://cdn.example/fonts/inter.woff2', as: 'font' },
        { rel: 'icon', href: '/favicon.ico' }
      ],
      stylesText: ':root { color-scheme: light; }',
      customCss:
        '@import "https://cdn.example/theme.css"; .hero { background-image: url(https://cdn.example/bg.png); }'
    })

    expect(risks.map((risk) => risk.id)).toEqual([
      'inline-head-style',
      'external-stylesheet:https://cdn.example/app.css',
      'external-preload:https://cdn.example/fonts/inter.woff2',
      'custom-css-url:https://cdn.example/theme.css',
      'custom-css-url:https://cdn.example/bg.png'
    ])
    expect(risks[2]?.detail).toContain('font-src')
  })

  test('reports unsafe custom CSS URL protocols before persistence', () => {
    const risks = analyzeCustomCodeCspRisks({
      meta: [],
      link: [],
      stylesText: '',
      customCss: `.hero { background-image: url("${`data${':'}image/svg+xml,<svg></svg>`}"); }`
    })

    expect(risks.map((risk) => risk.id)).toEqual([
      'custom-css-unsafe-url:data:image/svg+xml,<svg></svg>'
    ])
    expect(risks[0]?.title).toContain('will not be persisted')
  })

  test('keeps local-only custom resources quiet', () => {
    expect(
      analyzeCustomCodeCspRisks({
        meta: [],
        link: [{ rel: 'stylesheet', href: '/app.css' }],
        stylesText: '',
        customCss: '.hero { background-image: url(/hero.png); }'
      })
    ).toEqual([])
  })
})
