import { describe, expect, test } from 'bun:test'

import {
  taroAdapter,
  TARO_BABEL_REACT_PRESET_VERSION,
  TARO_BABEL_VERSION,
  TARO_REACT_VERSION,
  TARO_VERSION
} from '#compiler/adapters/taro'
import type { ComponentDef, IRElement, IREventHandler, IRTree } from '#compiler/ir/types'

import { withDefaults } from '@open-pencil/compiler'

import { pngSignatureBytes } from '#tests/helpers/image'

function taroOptions() {
  return withDefaults({
    packageName: 'taro-demo',
    productName: 'Taro 演示',
    target: 'taro',
    router: 'taro-router',
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

function expectValidTsx(source: string): void {
  expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(source)).not.toThrow()
}

interface TaroProjectConfig {
  appid?: string
}

describe('Taro React mini-program adapter', () => {
  test('emits a pinned source-only project directly from IR with local raster assets', () => {
    const asset = pngSignatureBytes(1, 2, 3)
    const output = taroAdapter.emit(
      [
        minimalIr({
          states: [
            {
              id: 'count-state',
              name: 'count',
              type: 'number',
              defaultValue: 0
            }
          ],
          assets: [{ path: 'assets/hero.png', bytes: asset }],
          children: [
            element({
              sourceId: 'hero',
              className: 'flex flex-col gap-4 bg-[url(./assets/hero.png)]',
              children: [
                { kind: 'text', value: 'Hello Taro' },
                {
                  kind: 'expression',
                  ast: { kind: 'ident', name: 'count' },
                  references: ['count']
                },
                element({
                  sourceId: 'increment',
                  tag: 'button',
                  className: 'rounded bg-primary px-4 py-2',
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
      taroOptions()
    )

    const page = textFile(output.files, 'src/pages/home/index.tsx')
    const style = textFile(output.files, 'src/pages/home/index.scss')
    const packageJSON = JSON.parse(textFile(output.files, 'package.json')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const projectConfig = JSON.parse(
      textFile(output.files, 'project.config.json')
    ) as TaroProjectConfig

    expect(output.files.has('src/app.config.ts')).toBe(true)
    expect(output.files.has('config/index.ts')).toBe(true)
    expect(textFile(output.files, 'babel.config.js')).toContain("presets: [['taro'")
    expect(output.files.has('src/assets/images/hero.png')).toBe(true)
    expect(output.files.has('index.html')).toBe(false)
    expect(output.files.has('vite.config.ts')).toBe(false)
    expect(packageJSON.dependencies['@tarojs/taro']).toBe(TARO_VERSION)
    expect(packageJSON.dependencies['@babel/runtime']).toBe(TARO_BABEL_VERSION)
    expect(packageJSON.dependencies.react).toBe(TARO_REACT_VERSION)
    expect(packageJSON.devDependencies['@babel/core']).toBe(TARO_BABEL_VERSION)
    expect(packageJSON.devDependencies['@babel/preset-react']).toBe(TARO_BABEL_REACT_PRESET_VERSION)
    expect(packageJSON.devDependencies['@tarojs/cli']).toBe(TARO_VERSION)
    expect(packageJSON.devDependencies['@tarojs/taro-loader']).toBe(TARO_VERSION)
    expect(packageJSON.devDependencies['babel-preset-taro']).toBe(TARO_VERSION)
    expect(
      Object.values(packageJSON.dependencies).every((version) => !version.startsWith('^'))
    ).toBe(true)
    expect(projectConfig).not.toHaveProperty('appid')
    expect(page).toContain("from '@tarojs/components'")
    expect(page).toContain('const [count, setCount] = useState(0)')
    expect(page).toContain('setCount(count + 1)')
    expect(page).toContain('src="../../assets/images/hero.png"')
    expect(style).toContain("background-image: url('../../assets/images/hero.png')")
    expect(output.files.get('src/assets/images/hero.png')).toEqual(asset)
    expectValidTsx(page)
  })

  test('maps authored routes to static Taro page paths and query parameters', () => {
    const home = minimalIr({
      pageId: 'home',
      pageName: 'Home',
      children: [
        element({
          sourceId: 'go-detail',
          tag: 'button',
          events: {
            onClick: [
              {
                kind: 'navigate',
                to: '/product/:id',
                params: [
                  {
                    name: 'id',
                    ast: { kind: 'string', value: 'sku-1' },
                    references: []
                  }
                ]
              }
            ]
          }
        })
      ]
    })
    const product = minimalIr({
      pageId: 'product',
      pageName: 'Product Detail',
      routePattern: '/product/:id',
      usesRouteParams: true,
      children: [
        {
          kind: 'expression',
          ast: { kind: 'member', object: { kind: 'ident', name: '$params' }, property: 'id' },
          references: ['$params']
        }
      ]
    })

    const output = taroAdapter.emit([home, product], taroOptions())
    const appConfig = textFile(output.files, 'src/app.config.ts')
    const homeSource = textFile(output.files, 'src/pages/home/index.tsx')
    const productSource = textFile(output.files, 'src/pages/product-detail/index.tsx')

    expect(appConfig).toContain('"pages/home/index"')
    expect(appConfig).toContain('"pages/product-detail/index"')
    expect(homeSource).toContain('Taro.navigateTo')
    expect(homeSource).toContain('/pages/product-detail/index?id=')
    expect(productSource).toContain('const $params = __router.params')
    expectValidTsx(homeSource)
    expectValidTsx(productSource)
  })

  test('fails closed for credentials, remote URLs, and unsupported web runtimes', () => {
    const secretURL = 'https://secret.example.invalid/rest'
    const secretKey = 'super-secret-anon-key'
    const apiAction = {
      kind: 'apiCall',
      method: 'GET',
      url: { kind: 'string', value: secretURL },
      docStateName: 'result'
    } as IREventHandler
    const output = taroAdapter.emit(
      [
        minimalIr({
          supabaseConfig: { url: secretURL, anonKey: secretKey } as IRTree['supabaseConfig'],
          docStates: [
            {
              id: 'result-state',
              name: 'result',
              type: 'object',
              defaultValue: {}
            }
          ],
          docStateReads: ['result'],
          docStateWrites: ['result'],
          children: [
            element({
              sourceId: 'remote-image',
              tag: 'img',
              image: { srcLiteral: 'https://images.example.invalid/secret.png', alt: '' }
            }),
            element({
              sourceId: 'remote-action',
              tag: 'button',
              events: { onClick: [apiAction] }
            })
          ]
        })
      ],
      taroOptions()
    )
    const source = allText(output.files)
    const codes = output.warnings.map((warning) => warning.code)

    expect(source).not.toContain(secretURL)
    expect(source).not.toContain(secretKey)
    expect(source).not.toContain('images.example.invalid')
    expect(source).not.toMatch(/\/Users\/|\/private\/|file:\/\//)
    expect(codes).toContain('taro-supabase-unsupported')
    expect(codes).toContain('taro-document-state-page-local-fallback')
    expect(codes).toContain('taro-image-remote-source-unsupported')
    expect(codes).toContain('taro-action-apiCall-unsupported')
  })

  test('emits components with safe text defaults and correct component asset paths', () => {
    const component: ComponentDef = {
      componentId: 'card-master',
      name: 'Card',
      props: [{ name: 'title', defaultValue: 'Default title', kind: 'text' }],
      children: [
        { kind: 'expression', ast: { kind: 'ident', name: 'title' }, references: ['title'] },
        element({
          sourceId: 'card-image',
          tag: 'img',
          image: { srcLiteral: 'assets/card.png', alt: 'Card' }
        })
      ],
      assets: [{ path: 'assets/card.png', bytes: pngSignatureBytes(1, 2, 3) }]
    }
    const output = taroAdapter.emit(
      [
        minimalIr({
          children: [
            {
              kind: 'componentRef',
              sourceId: 'card-use',
              name: 'Card',
              className: '',
              props: [{ name: 'title', value: 'Override', kind: 'text' }]
            }
          ]
        })
      ],
      taroOptions(),
      [component]
    )
    const page = textFile(output.files, 'src/pages/home/index.tsx')
    const componentPath = [...output.files.keys()].find(
      (path) => path.startsWith('src/components/') && path.endsWith('.tsx')
    )
    if (!componentPath) throw new Error('Missing generated Taro component')
    const componentSource = textFile(output.files, componentPath)

    expect(page).toContain('title="Override"')
    expect(componentSource).toContain('title = "Default title"')
    expect(componentSource).toContain('src="../assets/images/card.png"')
    expectValidTsx(page)
    expectValidTsx(componentSource)
  })

  test('aliases reserved component props and warns for component Motion and prototype runtime', () => {
    const component: ComponentDef = {
      componentId: 'reserved-master',
      name: 'ReservedCard',
      props: [{ name: 'class', defaultValue: 'Default class', kind: 'text' }],
      children: [
        {
          kind: 'expression',
          ast: { kind: 'ident', name: 'class' },
          references: ['class']
        }
      ],
      prototypeBody: true
    }
    const output = taroAdapter.emit(
      [
        minimalIr({
          children: [
            {
              kind: 'componentRef',
              sourceId: 'reserved-use',
              name: 'ReservedCard',
              className: '',
              motion: { version: 1, tracks: [], reducedMotion: 'reduce' },
              prototypeBody: true,
              props: [{ name: 'class', value: 'Override class', kind: 'text' }]
            }
          ]
        })
      ],
      taroOptions(),
      [component]
    )
    const page = textFile(output.files, 'src/pages/home/index.tsx')
    const componentPath = [...output.files.keys()].find(
      (path) => path.startsWith('src/components/') && path.endsWith('.tsx')
    )
    if (!componentPath) throw new Error('Missing generated Taro component')
    const componentSource = textFile(output.files, componentPath)
    const alias = /interface Props \{\n  ([A-Za-z_$][A-Za-z0-9_$]*)\?: string/.exec(
      componentSource
    )?.[1]
    if (!alias) throw new Error('Missing generated Taro component prop alias')

    expect(alias).not.toBe('class')
    expect(page).toContain(`${alias}="Override class"`)
    expect(componentSource).toContain(`${alias} = "Default class"`)
    expect(componentSource).toContain(`{${alias}}`)
    expect(componentSource).not.toContain('{class}')
    expectValidTsx(page)
    expectValidTsx(componentSource)
    expect(
      output.warnings
        .filter((warning) => warning.code === 'taro-component-motion-unsupported')
        .map((warning) => warning.nodeId)
    ).toContain('reserved-use')
    expect(
      output.warnings
        .filter((warning) => warning.code === 'taro-component-prototype-unsupported')
        .map((warning) => warning.nodeId)
    ).toEqual(expect.arrayContaining(['reserved-master', 'reserved-use']))
  })

  test('sanitizes project paths and enforces the shared page budget', () => {
    const safe = taroAdapter.emit(
      [minimalIr({ pageName: '../../CON', pageId: 'unsafe-page' })],
      taroOptions()
    )

    expect([...safe.files.keys()].every((path) => !path.split('/').includes('..'))).toBe(true)
    expect(safe.files.has('src/pages/index-con/index.tsx')).toBe(true)
    expect(safe.warnings.map((warning) => warning.code)).toContain('taro-page-path-sanitized')

    const tooMany = Array.from({ length: 101 }, (_, index) =>
      minimalIr({ pageId: `page-${index}`, pageName: `Page ${index}` })
    )
    expect(() => taroAdapter.emit(tooMany, taroOptions())).toThrow('page count exceeds')
  })
})
