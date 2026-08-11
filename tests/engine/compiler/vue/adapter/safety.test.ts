import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { vueAdapter } from '#compiler/adapters/vue'
import type { ComponentDef, IRElement, IRTree } from '#compiler/ir/types'
import { compileTemplate, parse as parseVueSfc } from 'vue/compiler-sfc'

import { compile, withDefaults, type CompilerFontManifest } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function vueOptions(router: 'vue-router-v4' | 'none' = 'none') {
  return withDefaults({
    packageName: 'vue-demo',
    target: 'vue',
    router,
    devMode: false
  })
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function minimalIr(overrides: Partial<IRTree> = {}): IRTree {
  return {
    pageId: 'page',
    pageName: 'Page',
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

function expectValidSfc(source: string): void {
  expect(source).toStartWith('<script setup lang="ts">')
  expect(source).toContain('</script>\n\n<template>')
  expect(source).toEndWith('</template>\n')
}

function compileVueTemplate(source: string): string {
  const parsed = parseVueSfc(source, { filename: 'Generated.vue' })
  expect(parsed.errors).toEqual([])
  const template = parsed.descriptor.template
  if (!template) throw new Error('Generated SFC is missing a template')
  const compiled = compileTemplate({ source: template.content, filename: 'Generated.vue', id: 'x' })
  expect(compiled.errors).toEqual([])
  return compiled.code
}

function maybeWriteVerificationProject(files: ReadonlyMap<string, string | Uint8Array>): void {
  const directory = process.env.OPENPENCIL_VUE_VERIFY_DIR
  if (!directory) return
  for (const [path, value] of files) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, value)
  }
}

function maybeWriteSafetyVerificationProject(
  files: ReadonlyMap<string, string | Uint8Array>
): void {
  const directory = process.env.OPENPENCIL_VUE_SAFETY_VERIFY_DIR
  if (!directory) return
  for (const [path, value] of files) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, value)
  }
}

describe('Vue compiler adapter safety and state', () => {
  test('emits typed radio and checkbox-group bindings that compose through state refs', () => {
    const output = vueAdapter.emit(
      [
        minimalIr({
          states: [
            { id: 'choice', name: 'choice', type: 'string', defaultValue: 'a' },
            { id: 'selected', name: 'selected', type: 'array', defaultValue: ['x'] }
          ],
          children: [
            element({
              sourceId: 'radio-a',
              tag: 'input',
              attrs: { type: 'radio', value: 'a' },
              controlled: {
                read: 'choice',
                write: { kind: 'state', name: 'choice', targetType: 'string' }
              }
            }),
            element({
              sourceId: 'radio-b',
              tag: 'input',
              attrs: { type: 'radio', value: 'b' },
              controlled: {
                read: 'choice',
                write: { kind: 'state', name: 'choice', targetType: 'string' }
              }
            }),
            element({
              sourceId: 'checkbox-x',
              tag: 'input',
              attrs: { type: 'checkbox', value: 'x' },
              controlled: {
                read: 'selected',
                write: { kind: 'state', name: 'selected', targetType: 'array' }
              }
            })
          ]
        })
      ],
      vueOptions()
    )
    const page = textFile(output.files, 'src/pages/index.vue')

    expect(page).toMatch(/__vueRef<string>\("a"\)/)
    expect(page).toMatch(/__vueRef<unknown\[]>\(\["x"\]\)/)
    expect(page).toMatch(/const __opOption_1 = "a"/)
    expect(page).toMatch(/:checked="__opState_choice_[a-z0-9]+ === __opOption_1"/)
    expect(page).toMatch(/__opState_choice_[a-z0-9]+\.value = "b"/)
    expect(page).toMatch(/:checked="__opState_selected_[a-z0-9]+\.includes\(__opOption_3\)"/)
    expect(page).toMatch(
      /__opState_selected_[a-z0-9]+\.value = \(__opEvent\.target as HTMLInputElement\)\.checked \? \[\.\.\.__opState_selected_[a-z0-9]+\.value, "x"\]/
    )
    expectValidSfc(page)
    maybeWriteVerificationProject(output.files)
  })

  test('keeps API result and error branch locals ahead of colliding list aliases', () => {
    const output = vueAdapter.emit(
      [
        minimalIr({
          states: [{ id: 'items', name: 'items', type: 'array', defaultValue: [] }],
          docStates: [{ id: 'result', name: 'result', type: 'string', defaultValue: '' }],
          docStateWrites: ['result'],
          children: [
            {
              kind: 'list',
              arrayName: 'items',
              itemName: 'data',
              indexName: 'error',
              template: element({
                sourceId: 'api-in-list',
                tag: 'button',
                events: {
                  onClick: [
                    {
                      kind: 'apiCall',
                      method: 'GET',
                      url: { kind: 'string', value: '/api/result' },
                      docStateName: 'result',
                      onSuccess: [
                        {
                          kind: 'setVariable',
                          docStateName: 'result',
                          ast: {
                            kind: 'member',
                            object: { kind: 'ident', name: 'data' },
                            property: 'value'
                          },
                          references: ['data'],
                          mode: 'absolute'
                        }
                      ],
                      onError: [
                        {
                          kind: 'clipboard',
                          ast: { kind: 'ident', name: 'error' },
                          references: ['error']
                        }
                      ]
                    }
                  ]
                }
              })
            }
          ]
        })
      ],
      vueOptions()
    )
    const page = textFile(output.files, 'src/pages/index.vue')

    expect(page).toContain('const __opData = await __opResponse.json()')
    expect(page).toContain('__setDocState("result", __opData.value)')
    expect(page).toContain('String(__opError)')
    expect(page).not.toMatch(/__setDocState\("result", __opLocal_[^.]+\.value\)/)
    expectValidSfc(page)
  })

  test('collects real API branch scopes and fails closed on ambiguous functional previous', () => {
    const graph = makeSceneGraph('Actions')
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'result', name: 'result', type: 'object', defaultValue: {} }]
    })
    graph.updateNode(pageId, {
      state: [
        { id: 'count', name: 'count', type: 'number', defaultValue: 0 },
        { id: 'previous-state', name: 'prev', type: 'number', defaultValue: 1 },
        { id: 'rows', name: 'rows', type: 'array', defaultValue: [{}] }
      ]
    })
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [
          {
            id: 'ambiguous',
            kind: 'setState',
            targetStateId: 'count',
            valueExpr: '$prev + prev'
          }
        ]
      }
    })
    const list = graph.createNode('LIST', pageId, {
      interactiveProps: {
        dataSourceRef: { kind: 'stateRef', stateId: 'rows' },
        itemName: 'data',
        indexName: 'error'
      }
    })
    graph.createNode('BUTTON', list.id, {
      events: {
        onClick: [
          {
            id: 'request',
            kind: 'apiCall',
            method: 'GET',
            url: '/api/result',
            targetName: 'result',
            onSuccess: [
              {
                id: 'store-result',
                kind: 'setVariable',
                targetName: 'result',
                valueExpr: 'data.value'
              }
            ],
            onError: [{ id: 'copy-error', kind: 'clipboard', valueExpr: 'error.message' }]
          }
        ]
      }
    })

    const output = compile({ graph, pageIds: [pageId], options: vueOptions() })
    const page = textFile(output.files, 'src/pages/index.vue')

    expect(output.warnings.map((warning) => warning.code)).toContain(
      'action-functional-prev-ambiguous'
    )
    expect(page).not.toContain('const __opPrevious =')
    expect(page).toContain('__setDocState("result", __opData.value)')
    expect(page).toContain('String(__opError.message)')
    expect(page).not.toMatch(/__setDocState\("result", __opLocal_[^.]+\.value\)/)
    expectValidSfc(page)
  })

  test('types document-state refs and keeps unsupported current-user reads runnable', () => {
    const graph = makeSceneGraph('Typed state')
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'amount', name: 'amount', type: 'number', defaultValue: 2 },
        { id: 'incoming', name: 'incoming', type: 'array', defaultValue: ['ready'] }
      ],
      lowcodeSupabaseConfig: { url: 'https://example.supabase.co', anonKey: 'public-anon' }
    })
    graph.updateNode(pageId, {
      state: [
        {
          id: 'total',
          name: 'total',
          type: 'number',
          defaultValue: 0,
          computedExpr: 'amount + 1'
        },
        { id: 'items', name: 'items', type: 'array', defaultValue: [] }
      ]
    })
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [
          {
            id: 'replace-items',
            kind: 'setState',
            targetStateId: 'items',
            valueExpr: 'incoming'
          }
        ]
      }
    })
    graph.createNode('TEXT', pageId, {
      bindings: { text: { kind: 'expr', expr: '$currentUser.email' } }
    })
    graph.createNode('TEXT', pageId, {
      bindings: { text: { kind: 'expr', expr: '$currentUser.profile.name' } }
    })

    const output = compile({ graph, pageIds: [pageId], options: vueOptions() })
    const page = textFile(output.files, 'src/pages/index.vue')

    expect(output.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['vue-supabase-unsupported', 'vue-current-user-binding-unsupported'])
    )
    expect(page).toContain(
      'const $currentUser = Object.freeze({ id: null, email: null, signedIn: false })'
    )
    expect(page).toMatch(/__useDocState<number>\("amount"\)/)
    expect(page).toMatch(/__useDocState<unknown\[]>\("incoming"\)/)
    expect(page).toMatch(/__vueRef<unknown\[]>\(\[\]\)/)
    expect(page).toMatch(/__opState_items_[a-z0-9]+\.value = __opDoc_incoming_[a-z0-9]+\.value/)
    expect(page).toMatch(/__vueComputed<number>\(\(\) => __opDoc_amount_[a-z0-9]+\.value \+ 1\)/)
    expect(page).toContain('__vueComputed(() => $currentUser.email)')
    expect(page).toContain('__vueComputed(() => undefined)')
    expectValidSfc(page)
    maybeWriteVerificationProject(output.files)
  })

  test('aliases reserved identifiers, list locals, and colliding query rows into valid SFCs', () => {
    const component: ComponentDef = {
      componentId: 'reserved-component',
      name: 'ReservedCard',
      props: [
        { name: 'class', kind: 'text', defaultValue: 'Class default' },
        { name: 'default', kind: 'text', defaultValue: 'Default default' }
      ],
      children: [],
      variantAxes: [
        { name: 'await', rawName: 'Await', options: ['Known', 'Danger'], defaultValue: 'Known' }
      ],
      variants: [
        {
          key: 'Known',
          children: [
            { kind: 'expression', ast: { kind: 'ident', name: 'class' }, references: ['class'] }
          ]
        },
        {
          key: 'Danger',
          children: [
            { kind: 'expression', ast: { kind: 'ident', name: 'default' }, references: ['default'] }
          ]
        }
      ]
    }
    const page = minimalIr({
      pageId: 'reserved',
      pageName: 'Reserved',
      states: [
        { id: 'ref', name: 'ref', type: 'string', defaultValue: 'ref value' },
        { id: 'computed', name: 'computed', type: 'number', defaultValue: 0 },
        { id: 'route', name: 'route', type: 'string', defaultValue: 'route value' },
        { id: 'products', name: 'productsRows', type: 'array', defaultValue: [] }
      ],
      docStates: [
        { id: 'get', name: 'getDocState', type: 'string', defaultValue: 'doc value' },
        { id: 'props', name: 'props', type: 'string', defaultValue: 'props value' }
      ],
      docStateReads: ['getDocState', 'props'],
      listQueries: [
        {
          rowsName: 'productsRows',
          setterName: 'setProductsRows',
          table: 'products',
          columns: '*',
          filters: [],
          orderBy: [],
          deps: []
        }
      ],
      children: [
        { kind: 'expression', ast: { kind: 'ident', name: 'ref' }, references: ['ref'] },
        {
          kind: 'expression',
          ast: { kind: 'ident', name: 'getDocState' },
          references: ['getDocState']
        },
        element({
          sourceId: 'reserved-input',
          tag: 'input',
          controlled: {
            read: 'route',
            write: { kind: 'state', name: 'route', targetType: 'string' }
          }
        }),
        {
          kind: 'list',
          arrayName: 'productsRows',
          itemName: 'event',
          indexName: 'prev',
          template: element({
            sourceId: 'reserved-event',
            tag: 'button',
            events: {
              onClick: [
                {
                  kind: 'setState',
                  stateName: 'computed',
                  ast: {
                    kind: 'binary',
                    op: '+',
                    left: { kind: 'ident', name: 'prev' },
                    right: { kind: 'number', value: 1 }
                  },
                  references: [],
                  mode: 'functional'
                },
                {
                  kind: 'clipboard',
                  ast: {
                    kind: 'member',
                    object: { kind: 'ident', name: 'event' },
                    property: 'label'
                  },
                  references: ['event']
                }
              ]
            },
            children: [
              {
                kind: 'expression',
                ast: {
                  kind: 'member',
                  object: { kind: 'ident', name: 'event' },
                  property: 'label'
                },
                references: ['event']
              }
            ]
          })
        },
        {
          kind: 'componentRef',
          sourceId: 'reserved-instance',
          name: 'ReservedCard',
          className: '',
          props: [
            { name: 'class', kind: 'text', value: 'Class value' },
            { name: 'default', kind: 'text', value: 'Default value' },
            { name: 'await', kind: 'variant', value: 'Unknown' }
          ]
        }
      ]
    })
    const output = vueAdapter.emit(
      [page, minimalIr({ pageId: 'second', pageName: 'Second' })],
      vueOptions('vue-router-v4'),
      [component]
    )
    const pageFile = textFile(output.files, 'src/pages/index.vue')
    const componentFile = textFile(output.files, 'src/components/ReservedCard.vue')

    expect(pageFile).not.toMatch(/const (ref|computed|route|getDocState|props)\s*=/)
    expect(componentFile).not.toMatch(/const (class|default|await|props|computed|ref)\s*=/)
    expect(pageFile).not.toMatch(/\(__opEvent: Event,\s*(event|prev): any/)
    expect(pageFile).toMatch(/v-for="\(__opLocal_[^,]+, __opLocal_[^)]+\)/)
    expect(pageFile).toContain('const __opPrevious =')
    expect(componentFile).toContain('.value].join')
    expect(componentFile).toContain('<template v-else>')
    expect(output.warnings.map((warning) => warning.code)).toContain('vue-identifier-shadowed')
    expect(compileVueTemplate(pageFile)).toContain('renderList')
    compileVueTemplate(componentFile)
    maybeWriteSafetyVerificationProject(output.files)
  })

  test('preserves font bytes and reports unsupported capability classes without fake runtimes', () => {
    const graph = makeSceneGraph('Fonts')
    const pageId = firstPageId(graph)
    graph.createNode('TEXT', pageId, { text: 'Font', fontFamily: 'Demo Sans' })
    const fontBytes = new Uint8Array([0, 1, 0, 0, 100, 101, 109, 111])
    const manifest: CompilerFontManifest = {
      faces: [
        {
          family: 'Demo Sans',
          weight: 400,
          style: 'normal',
          format: 'truetype',
          path: 'src/assets/fonts/demo.ttf',
          content: fontBytes,
          licenseEvidence: { kind: 'verified_open', licenseIds: ['OFL-1.1'] }
        }
      ]
    }
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ ...vueOptions(), i18n: true, uiKit: 'shadcn' }),
      fontManifest: manifest
    })

    expect(output.files.get('src/assets/fonts/demo.ttf')).toEqual(fontBytes)
    expect(textFile(output.files, 'src/index.css')).toContain('@font-face')
    expect(textFile(output.files, 'README.md')).toContain(
      'Font files are included only when the caller supplies redistribution-safe font assets'
    )
    expect(output.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['vue-i18n-unsupported', 'vue-ui-kit-unsupported'])
    )
    expect([...output.files.keys()].some((path) => path.includes('_lowcode_i18n'))).toBe(false)
    expect([...output.files.keys()].some((path) => path.includes('components/ui'))).toBe(false)
  })

  test('fails closed on authored raw HTML without emitting a v-html injection surface', () => {
    const output = vueAdapter.emit(
      [
        minimalIr({
          children: [
            element({
              sourceId: 'raw-html',
              rawHtml: '<img src=x onerror="globalThis.__VUE_RAW_HTML_PWN=1">'
            })
          ]
        })
      ],
      vueOptions()
    )
    const page = textFile(output.files, 'src/pages/index.vue')

    expect(page).toContain('<div></div>')
    expect(page).not.toContain('v-html')
    expect(page).not.toContain('__VUE_RAW_HTML_PWN')
    expect(output.warnings.map((warning) => warning.code)).toContain('vue-raw-html-unsupported')
    compileVueTemplate(page)
  })

  test('preserves safe metadata and source-language direction without silent route overrides', () => {
    const localized = vueAdapter.emit(
      [minimalIr()],
      withDefaults({
        ...vueOptions(),
        sourceLocale: 'zh-CN',
        metadata: {
          title: '中文标题',
          canonicalUrl: 'https://example.test/page',
          head: {
            meta: [{ kind: 'name', key: 'theme-color', content: '#ffffff' }],
            link: [{ rel: 'preconnect', href: 'https://cdn.example.test' }],
            styles: ['body { color: #111; }']
          }
        }
      })
    )
    const html = textFile(localized.files, 'index.html')

    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('<meta property="og:title" content="中文标题" />')
    expect(html).toContain('<meta property="og:url" content="https://example.test/page" />')
    expect(html).toContain('<meta name="theme-color" content="#ffffff" />')
    expect(html).toContain('<link rel="preconnect" href="https://cdn.example.test" />')
    expect(html).toContain('<style>body { color: #111; }</style>')

    const multipage = vueAdapter.emit(
      [minimalIr(), minimalIr({ pageId: 'two', pageName: 'Two' })],
      withDefaults({
        ...vueOptions('vue-router-v4'),
        sourceLocale: 'ar-EG',
        metadata: { pages: { two: { title: 'Route title' } } }
      })
    )
    expect(textFile(multipage.files, 'index.html')).toContain('<html lang="ar-EG" dir="rtl">')
    expect(multipage.warnings.map((warning) => warning.code)).toContain(
      'vue-page-metadata-unsupported'
    )

    const invalid = vueAdapter.emit(
      [minimalIr()],
      withDefaults({ ...vueOptions(), sourceLocale: 'bad locale"' })
    )
    expect(textFile(invalid.files, 'index.html')).toContain('<html lang="en">')
    expect(invalid.warnings.map((warning) => warning.code)).toContain('vue-source-locale-invalid')
  })
})
