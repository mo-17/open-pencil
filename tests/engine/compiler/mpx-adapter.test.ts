import { describe, expect, test } from 'bun:test'

import {
  MPX_CLI_PLUGIN_VERSION,
  MPX_CLI_SERVICE_VERSION,
  MPX_CORE_VERSION,
  mpxAdapter,
  PROCESS_BROWSER_VERSION,
  VUE_CLI_SERVICE_VERSION
} from '#compiler/adapters/mpx'
import type { ComponentDef, IRElement, IREventHandler, IRTree } from '#compiler/ir/types'

import { withDefaults } from '@open-pencil/compiler'

import { pngSignatureBytes } from '#tests/helpers/image'

function mpxOptions() {
  return withDefaults({
    packageName: 'mpx-demo',
    productName: 'Mpx 演示',
    target: 'mpx',
    router: 'mpx-router',
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

function firstScript(source: string): string {
  const match = /<script>\s*([\s\S]*?)\s*<\/script>/.exec(source)
  if (!match) throw new Error('Missing script block')
  return match[1]
}

interface MpxProjectConfig {
  appid?: string
  miniprogramRoot: string
}

describe('Mpx mini-program adapter', () => {
  test('emits a pinned buildable Mpx project directly from IR', () => {
    const imageBytes = pngSignatureBytes(1, 2, 3)
    const output = mpxAdapter.emit(
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
                { kind: 'text', value: 'Hello Mpx' },
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
      mpxOptions()
    )

    const page = textFile(output.files, 'src/pages/home/index.mpx')
    const packageJSON = JSON.parse(textFile(output.files, 'package.json')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const project = JSON.parse(textFile(output.files, 'project.config.json')) as MpxProjectConfig

    expect(output.files.has('src/app.mpx')).toBe(true)
    expect(output.files.has('vue.config.js')).toBe(true)
    expect(output.files.get('src/assets/images/hero.png')).toEqual(imageBytes)
    expect(packageJSON.dependencies['@mpxjs/core']).toBe(MPX_CORE_VERSION)
    expect(packageJSON.devDependencies['@mpxjs/mpx-cli-service']).toBe(MPX_CLI_SERVICE_VERSION)
    expect(packageJSON.devDependencies['@mpxjs/vue-cli-plugin-mpx']).toBe(MPX_CLI_PLUGIN_VERSION)
    expect(packageJSON.devDependencies).not.toHaveProperty('@mpxjs/vue-cli-plugin-mpx-mp')
    expect(packageJSON.devDependencies.process).toBe(PROCESS_BROWSER_VERSION)
    expect(JSON.parse(textFile(output.files, 'static/wx/project.config.json'))).not.toHaveProperty(
      'miniprogramRoot'
    )
    expect(packageJSON.devDependencies['@vue/cli-service']).toBe(VUE_CLI_SERVICE_VERSION)
    expect(
      [
        ...Object.values(packageJSON.dependencies),
        ...Object.values(packageJSON.devDependencies)
      ].every((version) => /^\d+\.\d+\.\d+$/.test(version))
    ).toBe(true)
    expect(project.miniprogramRoot).toBe('dist/wx/')
    expect(project).not.toHaveProperty('appid')
    expect(page).toContain('createPage({')
    expect(page).toContain('"count": 0')
    expect(page).toContain('wx:if="{{ visible }}"')
    expect(page).toContain('wx:for="{{ items }}"')
    expect(page).toContain('bindtap="op_onClick_')
    expect(page).toContain('src="../../assets/images/hero.png"')
    expect(page).toContain("background-image: url('../../assets/images/hero.png')")
    expect(() =>
      new Bun.Transpiler({ loader: 'js' }).transformSync(firstScript(page))
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
    const output = mpxAdapter.emit(
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
      mpxOptions()
    )
    const source = allText(output.files)
    const codes = output.warnings.map((warning) => warning.code)

    expect(source).not.toContain(remoteURL)
    expect(source).not.toContain(secret)
    expect(source).not.toContain('/Users/private/font.ttf')
    expect(source).not.toContain('<script src=')
    expect(source).toContain('color: #123456')
    expect(codes).toContain('mpx-supabase-runtime-unsupported')
    expect(codes).toContain('mpx-remote-or-missing-image-unsupported')
    expect(codes).toContain('mpx-api-call-unsupported')
    expect(codes).toContain('mpx-raw-html-unsupported')
    expect(codes).toContain('mpx-style-utility-unsupported')
  })

  test('emits reusable components with component-relative asset paths', () => {
    const component: ComponentDef = {
      componentId: 'card-master',
      name: 'Card',
      props: [],
      children: [
        element({
          sourceId: 'card-image',
          tag: 'img',
          className: 'bg-[url(./assets/card.png)]',
          image: { srcLiteral: 'assets/card.png', alt: 'Card' }
        })
      ],
      assets: [{ path: 'assets/card.png', bytes: pngSignatureBytes(1, 2, 3) }]
    }
    const output = mpxAdapter.emit(
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
      mpxOptions(),
      [component]
    )
    const page = textFile(output.files, 'src/pages/home/index.mpx')
    const componentSource = textFile(output.files, 'src/components/card.mpx')

    expect(page).toContain('<op-card />')
    expect(page).toContain('"op-card": "../../components/card"')
    expect(componentSource).toContain('src="../assets/images/card.png"')
    expect(componentSource).toContain("background-image: url('../assets/images/card.png')")
    expect(output.files.get('src/assets/images/card.png')).toEqual(pngSignatureBytes(1, 2, 3))
  })

  test('keeps document state read-only and omits document-state writes', () => {
    const output = mpxAdapter.emit(
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
      mpxOptions()
    )
    const page = textFile(output.files, 'src/pages/home/index.mpx')
    const codes = output.warnings.map((warning) => warning.code)

    expect(page).toContain('"cartCount": 1')
    expect(page).not.toContain('this.cartCount = 2')
    expect(page).not.toContain('wx:model="{{ cartCount }}"')
    expect(codes).toContain('mpx-document-state-page-local-fallback')
    expect(codes).toContain('mpx-document-state-action-unsupported')
    expect(codes).toContain('mpx-document-state-controlled-input-unsupported')
  })

  test('keeps normalized component tags and registrations unique', () => {
    const components = ['Card A', 'Card-A'].map(
      (name, index): ComponentDef => ({
        componentId: `card-${index}`,
        name,
        props: [],
        children: [{ kind: 'text', value: name }]
      })
    )
    const output = mpxAdapter.emit(
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
      mpxOptions(),
      components
    )
    const page = textFile(output.files, 'src/pages/home/index.mpx')

    expect(page).toContain('<op-card-a />')
    expect(page).toContain('<op-card-a-2 />')
    expect(page).toContain('"op-card-a": "../../components/card-a"')
    expect(page).toContain('"op-card-a-2": "../../components/card-a-2"')
    expect(output.files.has('src/components/card-a.mpx')).toBe(true)
    expect(output.files.has('src/components/card-a-2.mpx')).toBe(true)
  })

  test('sanitizes paths and enforces the shared page budget', () => {
    const safe = mpxAdapter.emit(
      [minimalIr({ pageName: '../../CON', pageId: 'unsafe-page' })],
      mpxOptions()
    )

    expect([...safe.files.keys()].every((path) => !path.split('/').includes('..'))).toBe(true)
    expect(safe.files.has('src/pages/index-con/index.mpx')).toBe(true)
    expect(safe.warnings.map((warning) => warning.code)).toContain('mpx-page-path-sanitized')

    const tooMany = Array.from({ length: 101 }, (_, index) =>
      minimalIr({ pageId: `page-${index}`, pageName: `Page ${index}` })
    )
    expect(() => mpxAdapter.emit(tooMany, mpxOptions())).toThrow('page count exceeds')
  })
})
