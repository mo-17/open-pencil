import { describe, expect, test } from 'bun:test'

import {
  WECHAT_MINIPROGRAM_MAIN_PACKAGE_MAX_BYTES,
  wechatMiniProgramAdapter
} from '#compiler/adapters/wechat-miniprogram'
import type { IRElement, IRTree } from '#compiler/ir/types'
import type { CompilerOptions } from '#compiler/types'

import { pngSignatureBytes, sizedPNGSignatureBytes } from '#tests/helpers/image'

interface WechatProjectConfig {
  appid?: string
}

function options(overrides: Partial<CompilerOptions> = {}): CompilerOptions {
  return {
    packageName: 'wechat-demo',
    productName: '微信演示',
    target: 'wechat-miniprogram' as CompilerOptions['target'],
    reactVersion: '19',
    router: 'wechat-native' as CompilerOptions['router'],
    typescript: true,
    devMode: false,
    ...overrides
  }
}

function ir(overrides: Partial<IRTree> = {}): IRTree {
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

describe('native WeChat Mini Program adapter', () => {
  test('emits native multipage WXML/WXSS/JS with local state, navigation, and assets', () => {
    const imageBytes = pngSignatureBytes(1, 2, 3)
    const home = ir({
      states: [
        { id: 'count', name: 'count', type: 'number', defaultValue: 0 },
        { id: 'name', name: 'name', type: 'string', defaultValue: '' },
        {
          id: 'items',
          name: 'items',
          type: 'array',
          defaultValue: [{ title: 'First' }]
        }
      ],
      assets: [{ path: 'src/assets/hero.png', bytes: imageBytes }],
      children: [
        element({
          sourceId: 'hero',
          className: 'flex flex-col gap-4 bg-[url(./assets/hero.png)] bg-cover',
          children: [{ kind: 'text', value: 'Hello mini program' }]
        }),
        element({
          sourceId: 'image',
          tag: 'img',
          image: { srcLiteral: './assets/hero.png', alt: 'Hero' }
        }),
        element({
          sourceId: 'name-input',
          tag: 'input',
          attrs: { placeholder: 'Your name' },
          controlled: {
            read: 'name',
            write: { kind: 'state', name: 'name', targetType: 'string' }
          }
        }),
        {
          kind: 'list',
          arrayName: 'items',
          itemName: 'item',
          indexName: 'index',
          template: {
            kind: 'expression',
            ast: {
              kind: 'member',
              object: { kind: 'ident', name: 'item' },
              property: 'title'
            },
            references: ['items']
          }
        },
        element({
          sourceId: 'next-button',
          tag: 'button',
          children: [{ kind: 'text', value: 'Next' }],
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
              },
              { kind: 'navigate', to: '/next-screen' }
            ]
          }
        })
      ]
    })
    const next = ir({
      pageId: 'next',
      pageName: 'Next Screen',
      children: [{ kind: 'text', value: 'Destination' }]
    })

    const output = wechatMiniProgramAdapter.emit([home, next], options())
    const app = JSON.parse(textFile(output.files, 'app.json')) as { pages: string[] }
    const project = JSON.parse(textFile(output.files, 'project.config.json')) as WechatProjectConfig
    const wxml = textFile(output.files, 'pages/home/index.wxml')
    const wxss = textFile(output.files, 'pages/home/index.wxss')
    const script = textFile(output.files, 'pages/home/index.js')

    expect(app.pages).toEqual(['pages/home/index', 'pages/next-screen/index'])
    expect(project.appid).toBeUndefined()
    expect(output.files.has('pages/home/index.json')).toBe(true)
    expect(output.files.has('pages/next-screen/index.wxml')).toBe(true)
    expect(output.files.get('assets/images/hero.png')).toEqual(imageBytes)
    expect(wxml).toContain('Hello mini program')
    expect(wxml).toContain('src="/assets/images/hero.png"')
    expect(wxml).toContain('bindinput=')
    expect(wxml).toContain('wx:for="{{ items }}"')
    expect(wxss).toContain('background-image: url("/assets/images/hero.png")')
    expect(script).toContain('this.setData')
    expect(script).toContain('wx.navigateTo({ url: "/pages/next-screen/index" })')
    expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(script)).not.toThrow()
  })

  test('fails closed for remote code, credentials, raw HTML, and local CSS paths', () => {
    const remoteURL = `https://evil.invalid/${'runtime.js'}`
    const secret = `secret-${'do-not-export'}`
    const page = ir({
      supabaseConfig: {
        url: 'https://project.supabase.co',
        anonKey: secret,
        schema: 'private'
      },
      analyticsConfig: { provider: 'posthog', id: secret, endpoint: remoteURL },
      children: [
        element({
          sourceId: 'remote-image',
          tag: 'img',
          image: { srcLiteral: remoteURL, alt: 'Remote' }
        }),
        element({
          sourceId: 'unsafe-style',
          attrs: {
            style: {
              kind: 'styleAttr',
              declarations: { fontFamily: '/Users/private/font.ttf', color: '#123456' }
            }
          }
        }),
        element({
          sourceId: 'raw-html',
          rawHtml: `<script src="${remoteURL}">${secret}</script>`
        })
      ]
    })

    const output = wechatMiniProgramAdapter.emit([page], options())
    const source = allText(output.files)
    const codes = output.warnings.map((warning) => warning.code)

    expect(source).not.toContain(remoteURL)
    expect(source).not.toContain(secret)
    expect(source).not.toContain('/Users/private/font.ttf')
    expect(source).not.toContain('<script')
    expect(source).toContain('color: #123456')
    expect(codes).toContain('wechat-miniprogram-network-runtime-unsupported')
    expect(codes).toContain('wechat-miniprogram-image-source-unsupported')
    expect(codes).toContain('wechat-miniprogram-raw-html-unsupported')
    expect(codes).toContain('wechat-miniprogram-style-unsupported')
  })

  test('keeps generated paths portable and rejects unsupported or colliding assets', () => {
    const firstBytes = pngSignatureBytes(1, 2, 3)
    const secondBytes = pngSignatureBytes(4, 5, 6)
    const page = ir({
      pageName: `../CON/${'x'.repeat(400)}`,
      assets: [
        { path: 'src/assets/Hero!.png', bytes: firstBytes },
        { path: 'src/assets/Hero@.png', bytes: secondBytes },
        { path: 'src/assets/not-really.png', bytes: new Uint8Array([1, 2, 3]) },
        { path: 'src/assets/vector.svg', bytes: new Uint8Array([7, 8]) }
      ]
    })

    const output = wechatMiniProgramAdapter.emit([page], options())
    const paths = [...output.files.keys()]
    const imagePaths = paths.filter((path) => path.startsWith('assets/images/'))
    const codes = output.warnings.map((warning) => warning.code)

    expect(paths.every((path) => !path.startsWith('/') && !path.includes('..'))).toBe(true)
    expect(paths.every((path) => new TextEncoder().encode(path).byteLength <= 240)).toBe(true)
    expect(imagePaths).toHaveLength(1)
    expect(codes).toContain('wechat-miniprogram-page-path-sanitized')
    expect(codes).toContain('wechat-miniprogram-image-asset-path-collision')
    expect(codes).toContain('wechat-miniprogram-image-asset-signature-invalid')
    expect(codes).toContain('wechat-miniprogram-image-asset-format-unsupported')
  })

  test('fails before claiming runnable output when the unsplit main package exceeds 2 MiB', () => {
    const chunkLength = Math.floor(WECHAT_MINIPROGRAM_MAIN_PACKAGE_MAX_BYTES * 0.55)
    const page = ir({
      assets: [
        { path: 'src/assets/one.png', bytes: sizedPNGSignatureBytes(chunkLength) },
        { path: 'src/assets/two.png', bytes: sizedPNGSignatureBytes(chunkLength) }
      ]
    })

    expect(() => wechatMiniProgramAdapter.emit([page], options())).toThrow(
      /wechat-miniprogram-main-package-byte-limit/
    )
  })
})
