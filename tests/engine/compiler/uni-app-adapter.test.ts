import { describe, expect, test } from 'bun:test'

import { uniAppAdapter } from '#compiler/adapters/uni-app'
import type { ComponentDef, IRElement, IREventHandler, IRTree } from '#compiler/ir/types'

import { withDefaults } from '@open-pencil/compiler'

import { pngSignatureBytes } from '#tests/helpers/image'

function uniAppOptions() {
  return withDefaults({
    packageName: 'uni-demo',
    productName: 'uni-app 演示',
    target: 'uni-app',
    router: 'uni-pages',
    devMode: false
  })
}

function minimalIr(overrides: Partial<IRTree> = {}): IRTree {
  return {
    pageId: 'page',
    pageName: 'Home',
    usesRouteParams: false,
    children: [],
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: [],
    ...overrides
  }
}

function element(overrides: Partial<IRElement> = {}): IRElement {
  return {
    kind: 'element',
    sourceId: 'element',
    tag: 'div',
    className: '',
    attrs: {},
    children: [],
    ...overrides
  }
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function allText(files: ReadonlyMap<string, string | Uint8Array>): string {
  return [...files.values()]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
}

function scriptSetup(source: string): string {
  const match = /<script setup>\s*([\s\S]*?)\s*<\/script>/.exec(source)
  if (!match) throw new Error('Missing script setup block')
  return match[1]
}

interface UniAppManifest {
  appid?: string
  name: string
  'mp-weixin': { appid?: string }
}

describe('uni-app mini-program adapter', () => {
  test('emits an importable HBuilderX project directly from IR', () => {
    const imageBytes = pngSignatureBytes(1, 2, 3)
    const output = uniAppAdapter.emit(
      [
        minimalIr({
          states: [
            { id: 'count', name: 'count', type: 'number', defaultValue: 0 },
            { id: 'visible', name: 'visible', type: 'boolean', defaultValue: true },
            { id: 'items', name: 'items', type: 'array', defaultValue: ['First'] }
          ],
          assets: [{ path: 'assets/hero.png', bytes: imageBytes }],
          children: [
            element({
              sourceId: 'hero',
              className: 'flex flex-col gap-4 bg-[url(./assets/hero.png)] bg-cover',
              children: [
                { kind: 'text', value: 'Hello uni-app' },
                {
                  kind: 'expression',
                  ast: { kind: 'ident', name: 'count' },
                  references: ['count']
                },
                {
                  kind: 'conditional',
                  ast: { kind: 'ident', name: 'visible' },
                  references: ['visible'],
                  consequent: { kind: 'text', value: 'Visible' }
                },
                {
                  kind: 'list',
                  arrayName: 'items',
                  itemName: 'item',
                  indexName: 'index',
                  template: {
                    kind: 'expression',
                    ast: { kind: 'ident', name: 'item' },
                    references: ['items']
                  }
                },
                element({
                  sourceId: 'increment',
                  tag: 'button',
                  children: [{ kind: 'text', value: 'Increment' }],
                  events: {
                    onClick: [
                      {
                        kind: 'setState',
                        stateName: 'count',
                        ast: {
                          kind: 'binary',
                          op: '+',
                          left: { kind: 'ident', name: 'count' },
                          right: { kind: 'number', value: 1 }
                        },
                        references: ['count'],
                        mode: 'absolute'
                      }
                    ]
                  }
                }),
                element({
                  sourceId: 'hero-image',
                  tag: 'img',
                  image: { srcLiteral: 'assets/hero.png', alt: 'Hero' }
                })
              ]
            })
          ]
        })
      ],
      uniAppOptions()
    )

    const page = textFile(output.files, 'pages/home/index.vue')
    const manifest = JSON.parse(textFile(output.files, 'manifest.json')) as UniAppManifest
    const pages = JSON.parse(textFile(output.files, 'pages.json')) as {
      pages: Array<{ path: string }>
    }

    expect(output.files.has('App.vue')).toBe(true)
    expect(output.files.has('main.js')).toBe(true)
    expect(output.files.has('uni.scss')).toBe(true)
    expect(output.files.get('static/images/hero.png')).toEqual(imageBytes)
    expect(output.files.has('package.json')).toBe(false)
    expect(manifest.name).toBe('uni-app 演示')
    expect(manifest).not.toHaveProperty('appid')
    expect(manifest['mp-weixin']).not.toHaveProperty('appid')
    expect(pages.pages.map((page) => page.path)).toEqual(['pages/home/index'])
    expect(page).toContain('const count = ref(0)')
    expect(page).toContain('v-if="visible"')
    expect(page).toContain('v-for="(item, index) in items"')
    expect(page).toContain('@tap="count = count + 1"')
    expect(page).toContain('src="/static/images/hero.png"')
    expect(page).toContain("background-image: url('/static/images/hero.png')")
    expect(() =>
      new Bun.Transpiler({ loader: 'js' }).transformSync(scriptSetup(page))
    ).not.toThrow()
  })

  test('fails closed for credentials, remote code, raw HTML, and local CSS paths', () => {
    const remoteURL = 'https://secret.example.invalid/runtime.js'
    const secret = 'super-secret-anon-key'
    const apiAction = {
      kind: 'apiCall',
      method: 'GET',
      url: { kind: 'string', value: remoteURL },
      docStateName: 'result'
    } as IREventHandler
    const output = uniAppAdapter.emit(
      [
        minimalIr({
          supabaseConfig: { url: remoteURL, anonKey: secret } as IRTree['supabaseConfig'],
          children: [
            element({
              sourceId: 'remote-image',
              tag: 'img',
              image: { srcLiteral: remoteURL, alt: '' }
            }),
            element({
              sourceId: 'remote-action',
              tag: 'button',
              events: { onClick: [apiAction] }
            }),
            element({
              sourceId: 'unsafe-style',
              attrs: {
                style: {
                  kind: 'styleAttr',
                  declarations: {
                    fontFamily: `Inter</style><script>${secret}</script>`,
                    letterSpacing: '/Users/private/font.ttf',
                    color: '#123456'
                  }
                }
              }
            }),
            element({
              sourceId: 'raw-html',
              rawHtml: `<script src="${remoteURL}">${secret}</script>`
            })
          ]
        })
      ],
      uniAppOptions()
    )
    const source = allText(output.files)
    const codes = output.warnings.map((warning) => warning.code)

    expect(source).not.toContain(remoteURL)
    expect(source).not.toContain(secret)
    expect(source).not.toContain('/Users/private/font.ttf')
    expect(source).not.toContain('<script src=')
    expect(source).toContain('color: #123456')
    expect(codes).toContain('uni-app-supabase-runtime-unsupported')
    expect(codes).toContain('uni-app-remote-or-missing-image-unsupported')
    expect(codes).toContain('uni-app-api-call-unsupported')
    expect(codes).toContain('uni-app-raw-html-unsupported')
    expect(codes).toContain('uni-app-style-utility-unsupported')
  })

  test('emits reusable components with local assets and portable paths', () => {
    const component: ComponentDef = {
      componentId: 'card-master',
      name: 'Card',
      props: [],
      children: [
        element({
          sourceId: 'card-image',
          tag: 'img',
          image: { srcLiteral: 'assets/card.png', alt: 'Card' }
        })
      ],
      assets: [{ path: 'assets/card.png', bytes: pngSignatureBytes(1, 2, 3) }]
    }
    const output = uniAppAdapter.emit(
      [
        minimalIr({
          children: [
            {
              kind: 'componentRef',
              sourceId: 'card-use',
              name: 'Card',
              className: '',
              props: []
            }
          ]
        })
      ],
      uniAppOptions(),
      [component]
    )
    const page = textFile(output.files, 'pages/home/index.vue')
    const componentSource = textFile(output.files, 'components/card.vue')

    expect(page).toContain("import Op_Card from '../../components/card.vue'")
    expect(page).toContain('<Op_Card />')
    expect(componentSource).toContain('src="/static/images/card.png"')
    expect(output.files.get('static/images/card.png')).toEqual(pngSignatureBytes(1, 2, 3))
  })

  test('keeps document state read-only and omits document-state writes', () => {
    const output = uniAppAdapter.emit(
      [
        minimalIr({
          docStates: [{ id: 'cart-count', name: 'cartCount', type: 'number', defaultValue: 1 }],
          docStateReads: ['cartCount'],
          docStateWrites: ['cartCount'],
          children: [
            element({
              sourceId: 'write-cart-count',
              tag: 'button',
              events: {
                onClick: [
                  {
                    kind: 'setVariable',
                    docStateName: 'cartCount',
                    ast: { kind: 'number', value: 2 },
                    references: [],
                    mode: 'absolute'
                  }
                ]
              }
            }),
            element({
              sourceId: 'control-cart-count',
              tag: 'input',
              controlled: {
                read: 'cartCount',
                write: { kind: 'docState', name: 'cartCount', targetType: 'number' }
              }
            })
          ]
        })
      ],
      uniAppOptions()
    )
    const page = textFile(output.files, 'pages/home/index.vue')
    const codes = output.warnings.map((warning) => warning.code)

    expect(page).toContain('const cartCount = ref(1)')
    expect(page).not.toContain('cartCount = 2')
    expect(page).not.toContain('v-model.number="cartCount"')
    expect(codes).toContain('uni-app-document-state-page-local-fallback')
    expect(codes).toContain('uni-app-document-state-action-unsupported')
    expect(codes).toContain('uni-app-document-state-controlled-input-unsupported')
  })

  test('keeps normalized component symbols and files unique', () => {
    const components = ['Card A', 'Card-A'].map(
      (name, index): ComponentDef => ({
        componentId: `card-${index}`,
        name,
        props: [],
        children: [{ kind: 'text', value: name }]
      })
    )
    const output = uniAppAdapter.emit(
      [
        minimalIr({
          children: components.map((component, index) => ({
            kind: 'componentRef' as const,
            sourceId: `card-use-${index}`,
            name: component.name,
            className: '',
            props: []
          }))
        })
      ],
      uniAppOptions(),
      components
    )
    const page = textFile(output.files, 'pages/home/index.vue')
    const symbols = [...page.matchAll(/^import (\w+) from '\.\.\/\.\.\/components\//gm)].map(
      (match) => match[1]
    )

    expect(symbols).toHaveLength(2)
    expect(new Set(symbols).size).toBe(2)
    expect(output.files.has('components/card-a.vue')).toBe(true)
    expect(output.files.has('components/card-a-2.vue')).toBe(true)
    for (const symbol of symbols) expect(page).toContain(`<${symbol} />`)
  })

  test('sanitizes paths and enforces the shared page budget', () => {
    const safe = uniAppAdapter.emit(
      [minimalIr({ pageName: '../../CON', pageId: 'unsafe-page' })],
      uniAppOptions()
    )

    expect([...safe.files.keys()].every((path) => !path.split('/').includes('..'))).toBe(true)
    expect(safe.files.has('pages/index-con/index.vue')).toBe(true)
    expect(safe.warnings.map((warning) => warning.code)).toContain('uni-app-page-path-sanitized')

    const tooMany = Array.from({ length: 101 }, (_, index) =>
      minimalIr({ pageId: `page-${index}`, pageName: `Page ${index}` })
    )
    expect(() => uniAppAdapter.emit(tooMany, uniAppOptions())).toThrow('page count exceeds')
  })
})
