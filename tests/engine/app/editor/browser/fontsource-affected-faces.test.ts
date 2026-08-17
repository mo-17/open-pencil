import { describe, expect, test } from 'bun:test'

import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm'

import { FontManager } from '@open-pencil/core/text'

import { createBrowserWebFontFetch } from '@/app/editor/fonts/browser-web-font-fetch'

const FONTSOURCE_VERSION = '5.3.0'
const BEBAS_SUBSETS = ['latin', 'latin-ext'] as const
const SOURCE_SANS_SUBSETS = [
  'cyrillic',
  'cyrillic-ext',
  'greek',
  'greek-ext',
  'latin',
  'latin-ext',
  'vietnamese'
] as const
const FORMATS = ['woff2', 'woff', 'ttf'] as const

function responseAt(url: string, body: BodyInit): Response {
  const response = new Response(body)
  Object.defineProperty(response, 'url', { configurable: true, value: url })
  return response
}

function staticFontsourceDetail(
  id: string,
  weights: readonly number[],
  styles: readonly ('normal' | 'italic')[],
  subsets: readonly string[]
) {
  const unicodeRange = Object.fromEntries(subsets.map((subset) => [subset, 'U+0000-00FF']))
  const variants: Record<string, unknown> = {}
  for (const weight of weights) {
    const styleVariants: Record<string, unknown> = {}
    for (const style of styles) {
      const subsetVariants: Record<string, unknown> = {}
      for (const subset of subsets) {
        subsetVariants[subset] = {
          url: Object.fromEntries(
            FORMATS.map((format) => [
              format,
              `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/${subset}-${weight}-${style}.${format}`
            ])
          )
        }
      }
      styleVariants[style] = subsetVariants
    }
    variants[String(weight)] = styleVariants
  }
  return { id, npmVersion: FONTSOURCE_VERSION, unicodeRange, variants }
}

const affectedCatalog = [
  {
    id: 'bebas-neue',
    family: 'Bebas Neue',
    subsets: BEBAS_SUBSETS,
    weights: [400],
    styles: ['normal'],
    defSubset: 'latin',
    variable: false
  },
  {
    id: 'source-sans-3',
    family: 'Source Sans 3',
    subsets: SOURCE_SANS_SUBSETS,
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    defSubset: 'latin',
    variable: true
  }
]

const affectedDetails = new Map([
  [
    'https://api.fontsource.org/v1/fonts/bebas-neue',
    staticFontsourceDetail('bebas-neue', [400], ['normal'], BEBAS_SUBSETS)
  ],
  [
    'https://api.fontsource.org/v1/fonts/source-sans-3',
    staticFontsourceDetail(
      'source-sans-3',
      [200, 300, 400, 500, 600, 700, 800, 900],
      ['normal', 'italic'],
      SOURCE_SANS_SUBSETS
    )
  ]
])

describe('browser Fontsource affected faces', () => {
  test('loads, registers, and caches the affected static faces', async () => {
    const seen: string[] = []
    const registrations: string[] = []
    const cacheWrites: Array<[family: string, style: string, characters: string]> = []
    const transport = createBrowserWebFontFetch({
      fetch: async (input) => {
        const url = String(input)
        seen.push(url)
        if (url === 'https://api.fontsource.org/v1/fonts') {
          return responseAt(url, JSON.stringify(affectedCatalog))
        }
        const detail = affectedDetails.get(url)
        if (detail) return responseAt(url, JSON.stringify(detail))
        if (url.startsWith('https://cdn.jsdelivr.net/fontsource/fonts/')) {
          return responseAt(url, Uint8Array.from([0, 1, 0, 0, 1, 2, 3, 4]))
        }
        throw new Error(`Unexpected Fontsource request: ${url}`)
      }
    })
    const manager = new FontManager()
    manager.attachProvider(
      {} as CanvasKit,
      {
        registerFont(_data: ArrayBuffer, family: string) {
          registrations.push(family)
        }
      } as TypefaceFontProvider
    )
    manager.setOnlineFontProviders({
      google: false,
      fontsource: true,
      bunny: false,
      fontshare: false
    })
    manager.setWebFontFetch(transport)
    manager.setDownloadedFontCache({
      async read() {
        return null
      },
      async write(family, style, _data, characters = '') {
        cacheWrites.push([family, style, characters])
      }
    })

    for (const [family, style] of [
      ['Bebas Neue', 'Bold'],
      ['Source Sans 3', 'Bold'],
      ['Source Sans 3', 'Medium'],
      ['Source Sans 3', 'Regular']
    ] as const) {
      const loaded = await manager.loadRemoteFont(family, style, 'Preview')
      expect(loaded).not.toBeNull()
      expect(manager.loadedFontSource(family, style)).toBe('fontsource')
    }

    expect(registrations).toEqual(['Bebas Neue', 'Source Sans 3', 'Source Sans 3', 'Source Sans 3'])
    expect(cacheWrites).toEqual([
      ['Bebas Neue', 'Bold', 'Peirvw'],
      ['Source Sans 3', 'Bold', 'Peirvw'],
      ['Source Sans 3', 'Medium', 'Peirvw'],
      ['Source Sans 3', 'Regular', 'Peirvw']
    ])

    const assetRequests = seen.filter((url) => url.startsWith('https://cdn.jsdelivr.net/'))
    expect(assetRequests).toContain(
      `https://cdn.jsdelivr.net/fontsource/fonts/bebas-neue@${FONTSOURCE_VERSION}/latin-400-normal.ttf`
    )
    for (const weight of [700, 500, 400]) {
      expect(assetRequests).toContain(
        `https://cdn.jsdelivr.net/fontsource/fonts/source-sans-3@${FONTSOURCE_VERSION}/latin-${weight}-normal.ttf`
      )
    }
    expect(assetRequests.some((url) => url.includes('bebas-neue@5.3.0/latin-700-normal.ttf'))).toBe(
      false
    )
    expect(assetRequests.some((url) => url.includes('bebas-neue@latest'))).toBe(false)
    expect(seen.some((url) => url.includes('/v1/variable/') || url.includes(':vf@'))).toBe(false)
  })
})
