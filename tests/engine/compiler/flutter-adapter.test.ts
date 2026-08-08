import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { flutterAdapter } from '#compiler/adapters/flutter'
import type { ComponentDef, IRElement, IRTree } from '#compiler/ir/types'

import {
  compile,
  safeFlutterPackageName,
  withDefaults,
  type CompilerFontManifest
} from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const DART = process.env.OPENPENCIL_DART_BIN ?? Bun.which('dart')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function flutterOptions(router: 'flutter-router' | 'none' = 'none') {
  return withDefaults({
    packageName: 'flutter-demo',
    productName: 'Flutter 演示',
    target: 'flutter',
    router,
    devMode: true
  })
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function expectDartFormats(files: ReadonlyMap<string, string | Uint8Array>): void {
  if (!DART || !existsSync(DART)) return
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-flutter-format-'))
  temporaryDirectories.push(directory)
  const dartFiles: string[] = []
  for (const [path, value] of files) {
    if (typeof value !== 'string' || !path.endsWith('.dart')) continue
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, value)
    dartFiles.push(destination)
  }
  const process = Bun.spawnSync({
    cmd: [DART, 'format', '--output=none', ...dartFiles],
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const diagnostics = `${process.stdout.toString()}${process.stderr.toString()}`
  expect(process.exitCode, diagnostics).toBe(0)
}

function pageFile(files: ReadonlyMap<string, string | Uint8Array>, includes?: string): string {
  const entry = [...files.entries()].find(
    ([path, value]) =>
      path.startsWith('lib/pages/') &&
      path.endsWith('.dart') &&
      typeof value === 'string' &&
      (includes === undefined || value.includes(includes))
  )
  if (!entry || typeof entry[1] !== 'string') throw new Error('Missing generated Flutter page')
  return entry[1]
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

function maybeWriteVerificationProject(files: ReadonlyMap<string, string | Uint8Array>): void {
  const directory = process.env.OPENPENCIL_FLUTTER_VERIFY_DIR
  if (!directory) return
  for (const [path, value] of files) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, value)
  }
}

describe('Flutter compiler adapter', () => {
  test('emits a source-only native Widget project with state, lists, inputs, and raster assets', () => {
    const graph = makeSceneGraph('Home')
    const pageId = firstPageId(graph)
    graph.updateNode(pageId, {
      state: [
        { id: 'count-state', name: 'count', type: 'number', defaultValue: 0 },
        {
          id: 'items-state',
          name: 'items',
          type: 'array',
          defaultValue: [{ title: 'First' }]
        },
        { id: 'name-state', name: 'name', type: 'string', defaultValue: '' }
      ]
    })
    const stack = graph.createNode('FRAME', pageId, {
      name: 'Stack',
      layoutMode: 'VERTICAL',
      width: 360,
      height: 640,
      gap: 12,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16
    })
    graph.createNode('TEXT', stack.id, {
      text: 'Hello $name ${expr} \\ $value\r\n\0\u2028\u2029\ud800 😀'
    })
    const button = graph.createNode('BUTTON', stack.id, {
      interactiveProps: { text: 'Increment' }
    })
    button.events = {
      onClick: [
        {
          id: 'increment',
          kind: 'setState',
          targetStateId: 'count-state',
          valueExpr: 'count + 1'
        }
      ]
    }
    graph.createNode('INPUT', stack.id, {
      interactiveProps: { placeholder: 'Your $name' },
      bindings: { value: { kind: 'ref', stateId: 'name-state' } }
    })
    const list = graph.createNode('LIST', stack.id, {
      interactiveProps: {
        dataSourceRef: { kind: 'stateRef', stateId: 'items-state' },
        itemName: 'class',
        indexName: 'switch'
      }
    })
    graph.createNode('TEXT', list.id, {
      text: 'Fallback',
      bindings: { text: { kind: 'expr', expr: 'item.profile.name' } }
    })
    const imageBytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )
    graph.images.set('hero-image', imageBytes)
    graph.createNode('RECTANGLE', stack.id, {
      width: 320,
      height: 180,
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'hero-image',
          imageScaleMode: 'FIT',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })

    const output = compile({ graph, pageIds: [pageId], options: flutterOptions() })
    const main = textFile(output.files, 'lib/main.dart')
    const page = pageFile(output.files)
    const pubspec = textFile(output.files, 'pubspec.yaml')
    const imagePath = [...output.files.keys()].find((path) => path.startsWith('assets/images/'))

    expect(output.files.has('README.md')).toBe(true)
    expect(output.files.has('android/app/build.gradle')).toBe(false)
    expect(output.files.has('ios/Runner.xcodeproj')).toBe(false)
    expect(main).toContain('MaterialApp')
    expect(page).toContain('SafeArea')
    expect(page).toContain('SingleChildScrollView')
    expect(page).toContain('TextButton')
    expect(page).toContain('TextFormField')
    expect(page).toContain('OpenPencilRuntime.list')
    expect(page).toContain('setState')
    expect(page).not.toContain('WebView')
    expect(page).not.toContain('\\ud800')
    expect(imagePath).toBeDefined()
    expect(output.files.get(imagePath as string)).toEqual(imageBytes)
    expect(pubspec).toContain(`- ${JSON.stringify(imagePath)}`)
    expect(output.files.has('analysis_options.yaml')).toBe(true)
    expect(output.files.has('test/widget_test.dart')).toBe(true)
    expect(textFile(output.files, 'README.md')).toContain('--no-pub')
    expect(textFile(output.files, 'README.md')).toContain('dart format lib test')
    maybeWriteVerificationProject(output.files)
    expectDartFormats(output.files)
  })

  test('emits router-free route and query expressions without widget route fields', () => {
    const ir = minimalIr({
      usesRouteParams: true,
      usesQueryParams: true,
      children: [
        {
          kind: 'expression',
          ast: {
            kind: 'member',
            object: { kind: 'ident', name: '$params' },
            property: 'id'
          },
          references: ['$params']
        },
        {
          kind: 'expression',
          ast: {
            kind: 'member',
            object: { kind: 'ident', name: '$query' },
            property: 'filter'
          },
          references: ['$query']
        }
      ]
    })
    const output = flutterAdapter.emit([ir], flutterOptions())
    const page = pageFile(output.files)

    expect(page).toContain('const <String, String>{}')
    expect(page).not.toContain('widget.routeParams')
    expect(page).not.toContain('widget.queryParams')
    expectDartFormats(output.files)
  })

  test('keeps component prop fields and callers aligned for inherited member names', () => {
    const definition: ComponentDef = {
      componentId: 'widget-component',
      name: 'Widget',
      props: [
        { name: 'key', defaultValue: 'Key default', kind: 'text' },
        { name: 'hashCode', defaultValue: 'Hash default', kind: 'text' },
        { name: 'createElement', defaultValue: 'Element default', kind: 'text' }
      ],
      children: [
        {
          kind: 'expression',
          ast: { kind: 'ident', name: 'key' },
          references: ['key']
        },
        {
          kind: 'expression',
          ast: { kind: 'ident', name: 'hashCode' },
          references: ['hashCode']
        },
        element({
          sourceId: 'component-increment',
          tag: 'button',
          events: {
            onClick: [
              {
                kind: 'setVariable',
                docStateName: 'count',
                ast: {
                  kind: 'binary',
                  op: '+',
                  left: { kind: 'ident', name: 'prev' },
                  right: { kind: 'number', value: 1 }
                },
                references: [],
                mode: 'functional'
              }
            ]
          }
        })
      ],
      docStateWrites: ['count']
    }
    const ir = minimalIr({
      children: [
        {
          kind: 'componentRef',
          sourceId: 'widget-ref',
          name: 'Widget',
          className: '',
          props: [
            { name: 'key', kind: 'text', value: 'Key override' },
            { name: 'hashCode', kind: 'text', value: 'Hash override' },
            { name: 'createElement', kind: 'text', value: 'Element override' }
          ]
        }
      ]
    })
    const output = flutterAdapter.emit([ir], flutterOptions(), [definition])
    const component = textFile(output.files, 'lib/components/widget.dart')
    const page = pageFile(output.files)
    const fields = [...component.matchAll(/final String (opProp\w+);/g)].map((match) => match[1])

    expect(component).toContain('class WidgetComponent extends StatelessWidget')
    expect(fields).toHaveLength(3)
    expect(fields).not.toContain('key')
    expect(fields).not.toContain('hashCode')
    expect(fields).not.toContain('createElement')
    for (const field of fields) {
      expect(component).toContain(`this.${field}`)
      expect(page).toContain(`${field}:`)
    }
    expect(component).toContain(
      'updateValue("count", (previous) => OpenPencilRuntime.add(previous, 1))'
    )
    expect(output.warnings.map((warning) => warning.code)).not.toContain(
      'flutter-expression-identifier-unsupported'
    )
    expectDartFormats(output.files)
  })

  test('names page state and list locals without semantic shadowing', () => {
    const ir = minimalIr({
      states: [
        {
          id: 'items',
          name: 'openPencilItems',
          type: 'array',
          defaultValue: ['one']
        },
        { id: 'entry', name: 'entry', type: 'string', defaultValue: 'state entry' },
        { id: 'next', name: 'next', type: 'number', defaultValue: 1 },
        { id: 'hash', name: 'hashCode', type: 'number', defaultValue: 2 },
        { id: 'activate', name: 'activate', type: 'boolean', defaultValue: true }
      ],
      children: [
        {
          kind: 'list',
          arrayName: 'openPencilItems',
          itemName: 'entry',
          indexName: 'next',
          template: {
            kind: 'expression',
            ast: { kind: 'ident', name: 'entry' },
            references: ['entry']
          }
        }
      ]
    })
    const output = flutterAdapter.emit([ir], flutterOptions())
    const page = pageFile(output.files)

    expect(page).toContain('dynamic opStateOpenPencilItems')
    expect(page).toContain('dynamic opStateEntry')
    expect(page).toContain('dynamic opStateNext')
    expect(page).toContain('dynamic opStateHashCode')
    expect(page).toContain('dynamic opStateActivate')
    expect(page).toContain('openPencilItems.asMap().entries.map((openPencilEntry)')
    expect(page).toContain('OpenPencilRuntime.text(openPencilEntry.value)')
    expect(page).not.toContain('final opItemEntry')
    expect(page).not.toContain('final opIndexNext')
    expect(page).not.toContain('dynamic hashCode')
    expectDartFormats(output.files)
  })

  test('formats fractional and anchorless absolute positioning', () => {
    const ir = minimalIr({
      children: [
        element({
          sourceId: 'fractional',
          className: 'absolute top-[12.5px] h-[10.25px]'
        }),
        element({ sourceId: 'anchorless', className: 'absolute' }),
        element({
          sourceId: 'negative-style',
          className:
            'text-[-5px] leading-[-4px] border-[-1px] rounded-[-2px] bg-[#12345] placeholder:text-[#12345]'
        })
      ]
    })
    const output = flutterAdapter.emit([ir], flutterOptions())
    const page = pageFile(output.files)

    expect(page).toContain('height: 22.75')
    expect(page).toContain('Positioned(child:')
    expect(page).not.toContain('22.75.0')
    expect(page).not.toContain('Positioned(,')
    expect(page).not.toContain('undefined')
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'flutter-style-negative-constraint-clamped'
    )
    expectDartFormats(output.files)
  })

  test('uses list callback values directly for index-only, static, and nested templates', () => {
    const ir = minimalIr({
      states: [
        {
          id: 'values',
          name: 'values',
          type: 'array',
          defaultValue: [['nested'], ['again']]
        }
      ],
      children: [
        {
          kind: 'list',
          arrayName: 'values',
          itemName: 'unusedItem',
          indexName: 'position',
          template: {
            kind: 'expression',
            ast: { kind: 'ident', name: 'position' },
            references: ['position']
          }
        },
        {
          kind: 'list',
          arrayName: 'values',
          itemName: 'unusedItem2',
          indexName: 'unusedIndex2',
          template: { kind: 'text', value: 'Static' }
        },
        {
          kind: 'list',
          arrayName: 'values',
          itemName: 'outer',
          indexName: 'outerIndex',
          template: {
            kind: 'list',
            arrayName: 'outer',
            itemName: 'inner',
            indexName: 'innerIndex',
            template: {
              kind: 'expression',
              ast: { kind: 'ident', name: 'outer' },
              references: ['outer']
            }
          }
        }
      ]
    })
    const output = flutterAdapter.emit([ir], flutterOptions())
    const page = pageFile(output.files)

    expect(page).toContain('OpenPencilRuntime.text(openPencilEntry.key)')
    expect(page).toContain('Text("Static")')
    expect(page).toContain('OpenPencilRuntime.list(openPencilEntry.value)')
    expect(page).toContain('entries.map((openPencilEntry2)')
    expect(page).not.toContain('final opItem')
    expect(page).not.toContain('final opIndex')
    expectDartFormats(output.files)
  })

  test('emits centralized MaterialPageRoute navigation and protects dynamic route segments', () => {
    const graph = new SceneGraph()
    const home = graph.getPages()[0]
    home.name = 'Home'
    const product = graph.addPage('Product')
    const unsafe = graph.addPage('Unsafe')
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id' })
    graph.updateNode(unsafe.id, { lowcodeRoutePattern: '/:__proto__' })
    graph.updateNode(home.id, {
      state: [{ id: 'product-id', name: 'productId', type: 'string', defaultValue: '42' }]
    })
    graph.createNode('BUTTON', home.id, {
      interactiveProps: { text: 'Product' },
      events: {
        onClick: [
          {
            id: 'navigate-product',
            kind: 'navigate',
            to: '/product/:id',
            params: { id: 'productId' }
          }
        ]
      }
    })
    graph.createNode('TEXT', product.id, {
      text: 'Product',
      bindings: { text: { kind: 'expr', expr: '$params.id' } }
    })

    const output = compile({
      graph,
      pageIds: [home.id, product.id, unsafe.id],
      options: flutterOptions('flutter-router')
    })
    const main = textFile(output.files, 'lib/main.dart')
    const homePage = pageFile(output.files, 'Navigator.of(context)')
    const productPage = pageFile(output.files, 'widget.routeParams')

    expect(main).toContain('onGenerateRoute: _openPencilRouteFactory')
    expect(main).toContain('MaterialPageRoute<void>')
    expect(main).toContain('"/product/:id"')
    expect(homePage).toContain('Navigator.of(context).pushNamed')
    expect(homePage).toContain('OpenPencilRuntime.route')
    expect(productPage).toContain('widget.routeParams')
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'flutter-route-pattern-unsupported'
    )
    expectDartFormats(output.files)
  })

  test('matches route parameters by segment and preserves the first duplicate authored route', () => {
    const first = minimalIr({
      pageId: 'first',
      pageName: 'First',
      routePattern: '/foo',
      children: [
        element({
          sourceId: 'first-link',
          tag: 'button',
          events: { onClick: [{ kind: 'navigate', to: '/foo' }] }
        })
      ]
    })
    const duplicate = minimalIr({
      pageId: 'duplicate',
      pageName: 'Second',
      routePattern: '/foo'
    })
    const dynamic = minimalIr({
      pageId: 'dynamic',
      pageName: 'Dynamic',
      routePattern: '/product/:id/:id2'
    })
    const reserved = minimalIr({
      pageId: 'reserved',
      pageName: 'constructor',
      routePattern: '/constructor'
    })
    const output = flutterAdapter.emit(
      [first, duplicate, dynamic, reserved],
      flutterOptions('flutter-router')
    )
    const main = textFile(output.files, 'lib/main.dart')
    const runtime = textFile(output.files, 'lib/openpencil_runtime.dart')
    const firstPage = pageFile(output.files, 'Navigator.of(context)')

    expect([...main.matchAll(/_matchOpenPencilRoute\("\/foo", path\)/g)]).toHaveLength(1)
    expect(main).toContain('"/product/:id/:id2"')
    expect(main).toContain('"/openpencil-constructor"')
    expect(main).not.toContain('"/constructor"')
    expect(firstPage).toContain('pushNamed("/foo")')
    expect(runtime).toContain('for (final segment in uri.pathSegments)')
    expect(runtime).toContain(
      "if (!params.containsKey(name)) return '/__openpencil_invalid_route__';"
    )
    expect(runtime).not.toContain('replaceAll')
    expect(output.warnings.map((warning) => warning.code)).toContain('flutter-route-collision')
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'flutter-route-pattern-unsupported'
    )
    expectDartFormats(output.files)
  })

  test('emits a visible landing fallback when every route is dynamic', () => {
    const output = flutterAdapter.emit(
      [
        minimalIr({ pageId: 'one', pageName: 'One', routePattern: '/one/:id' }),
        minimalIr({ pageId: 'two', pageName: 'Two', routePattern: '/two/:slug' })
      ],
      flutterOptions('flutter-router')
    )
    const main = textFile(output.files, 'lib/main.dart')

    expect(main).toContain('Open a concrete application route')
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'flutter-dynamic-initial-route-unavailable'
    )
    expectDartFormats(output.files)
  })

  test('chooses deterministic portable raster assets and rejects unsafe names', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const ir = minimalIr({
      assets: [
        { path: 'src/assets/A.png', bytes },
        { path: 'src/assets/a.png', bytes },
        { path: 'src/assets/con.png', bytes },
        { path: 'src/assets/bad:name.png', bytes },
        { path: 'src/assets/bad\u202ename.png', bytes }
      ],
      children: [
        element({
          sourceId: 'asset-image',
          tag: 'img',
          image: { srcLiteral: './assets/a.png', alt: 'Asset' }
        }),
        element({ sourceId: 'date-input', tag: 'input', attrs: { type: 'date' } })
      ]
    })
    const output = flutterAdapter.emit([ir], {
      ...flutterOptions(),
      productName: 'Unsafe\u0085\u202eName'
    })
    const page = pageFile(output.files)
    const pubspec = textFile(output.files, 'pubspec.yaml')
    const main = textFile(output.files, 'lib/main.dart')

    expect([...output.files.keys()].filter((path) => path.startsWith('assets/images/'))).toEqual([
      'assets/images/A.png'
    ])
    expect(page).toContain('Image.asset("assets/images/A.png"')
    expect(page).toContain('const SizedBox.shrink()')
    expect(pubspec).toContain('\\u0085')
    expect(pubspec).toContain('\\u202e')
    expect(main).toContain('\\u0085')
    expect(main).toContain('\\u202e')
    expect(pubspec).not.toContain('\u202e')
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'flutter-image-asset-format-unsupported'
    )
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'flutter-form-control-unsupported'
    )
    expectDartFormats(output.files)
  })

  test('warns and fails closed for document-state persistence and computed writers', () => {
    const output = flutterAdapter.emit(
      [
        minimalIr({
          docStates: [
            {
              id: 'persisted',
              name: 'persisted',
              type: 'string',
              defaultValue: 'value',
              persist: true,
              storageKey: 'saved',
              storageVersion: '2'
            },
            {
              id: 'computed',
              name: 'computed',
              type: 'number',
              defaultValue: 1,
              computed: { ast: { kind: 'number', value: 2 }, references: [] }
            },
            {
              id: 'invalid-computed',
              name: 'invalidComputed',
              type: 'number',
              defaultValue: 0,
              computedInvalid: true
            }
          ]
        })
      ],
      flutterOptions()
    )
    const runtime = textFile(output.files, 'lib/openpencil_runtime.dart')
    const codes = output.warnings.map((warning) => warning.code)

    expect(codes).toContain('flutter-document-state-persistence-unsupported')
    expect(codes).toContain('flutter-document-state-computed-unsupported')
    expect(runtime).toContain('static const Set<String> _readOnlyNames')
    expect(runtime).toContain('"computed"')
    expect(runtime).toContain('"invalidComputed"')
    expect(runtime).toContain('if (_readOnlyNames.contains(name)) return;')
    expectDartFormats(output.files)
  })

  test('allocates bounded Dart-safe component and prop names', () => {
    const graph = makeSceneGraph('Components')
    const pageId = firstPageId(graph)
    const component = graph.createNode('COMPONENT', pageId, { name: 'class' })
    graph.createNode('TEXT', component.id, { name: 'Title', text: 'Default' })
    graph.createInstance(component.id, pageId, {
      componentProperties: { Title: { type: 'TEXT', value: 'Override' } }
    })

    const output = compile({ graph, pageIds: [pageId], options: flutterOptions() })
    const componentPath = [...output.files.keys()].find((path) =>
      path.startsWith('lib/components/')
    )
    expect(componentPath).toBeDefined()
    expect(componentPath?.split('/').at(-1)?.length).toBeLessThanOrEqual(85)
    expectDartFormats(output.files)
  })

  test('fails closed when a font manifest lacks complete license notices', () => {
    const graph = makeSceneGraph('Fonts')
    const pageId = firstPageId(graph)
    graph.createNode('TEXT', pageId, {
      text: 'Font sample',
      fontFamily: 'Native Font',
      fontWeight: 700,
      fontSize: 18
    })
    const bytes = new Uint8Array([0, 1, 0, 0, 0, 1, 0, 0])
    const manifest: CompilerFontManifest = {
      faces: [
        {
          family: 'Native Font',
          weight: 700,
          style: 'normal',
          format: 'truetype',
          path: 'src/assets/fonts/native-font-700.ttf',
          content: bytes,
          licenseEvidence: { kind: 'verified_open', licenseIds: ['OFL-1.1'] }
        }
      ]
    }
    const output = compile({
      graph,
      pageIds: [pageId],
      options: flutterOptions(),
      fontManifest: manifest
    })
    const pubspec = textFile(output.files, 'pubspec.yaml')
    const page = pageFile(output.files)

    expect([...output.files.keys()].some((path) => path.includes('/fonts/'))).toBe(false)
    expect(pubspec).not.toContain('fonts:')
    expect(page).toContain('fontFamily: "Native Font"')
    expect(output.files.has('FONT_LICENSES.md')).toBe(false)
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'font-license-notice-unavailable'
    )
    expectDartFormats(output.files)
  })

  test('keeps package and source string generation collision-safe', () => {
    const prefix = 'a'.repeat(80)
    expect(safeFlutterPackageName(`${prefix}x`)).not.toBe(safeFlutterPackageName(`${prefix}y`))
    expect(safeFlutterPackageName('中文')).not.toBe(safeFlutterPackageName('日本語'))
    expect(safeFlutterPackageName('123 demo')).toStartWith('openpencil_')
    expect(safeFlutterPackageName(`${prefix}x`).length).toBeLessThanOrEqual(64)
  })
})
