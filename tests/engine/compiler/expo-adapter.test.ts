import { describe, expect, test } from 'bun:test'

import { translateExpoStyle } from '#compiler/adapters/expo/style'

import {
  compile,
  withDefaults,
  type CompilerFontManifest,
  type CompileWarning
} from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function expoOptions(router: 'expo-router' | 'none' = 'none') {
  return withDefaults({
    packageName: 'mobile-demo',
    productName: '移动演示',
    target: 'expo',
    router,
    devMode: false
  })
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function expectValidTsx(source: string): void {
  expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(source)).not.toThrow()
}

describe('Expo React Native compiler adapter', () => {
  test('emits a source-only Expo project with native controls and no DOM shell', () => {
    const graph = makeSceneGraph('Home')
    const pageId = firstPageId(graph)
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
    graph.createNode('TEXT', stack.id, { text: 'Hello native', fontSize: 24 })
    graph.createNode('BUTTON', stack.id, { interactiveProps: { text: 'Continue' } })
    graph.createNode('INPUT', stack.id, { interactiveProps: { placeholder: 'Your name' } })
    graph.createNode('SWITCH', stack.id)

    const output = compile({ graph, pageIds: [pageId], options: expoOptions() })
    const page = textFile(output.files, 'src/pages/index.tsx')
    const packageJSON = JSON.parse(textFile(output.files, 'package.json')) as {
      main: string
      dependencies: Record<string, string>
      engines: { node: string }
      scripts: Record<string, string>
    }

    expect(output.files.has('App.tsx')).toBe(true)
    expect(output.files.has('app.json')).toBe(true)
    expect(output.files.has('README.md')).toBe(true)
    expect(output.files.has('index.html')).toBe(false)
    expect(output.files.has('vite.config.ts')).toBe(false)
    expect(packageJSON.main).toBe('expo/AppEntry')
    expect(packageJSON.engines.node).toBe('>=22.13.0')
    expect(packageJSON.dependencies.expo).toBeDefined()
    expect(packageJSON.dependencies['react-native']).toBeDefined()
    expect(packageJSON.dependencies.expo).toBe('~57.0.10')
    expect(packageJSON.dependencies.react).toBe('19.2.3')
    expect(packageJSON.dependencies['react-native']).toBe('0.86.2')
    expect(packageJSON.dependencies['react-native-safe-area-context']).toBe('~5.7.0')
    expect(packageJSON.scripts.typecheck).toBe('tsc --noEmit')
    expect(page).toContain("from 'react-native'")
    expect(page).toContain('<SafeAreaView')
    expect(page).toContain('<KeyboardAvoidingView')
    expect(page).toContain('<ScrollView')
    expect(page).toContain('<Text')
    expect(page).toContain('Hello native')
    expect(page).toContain('<Pressable')
    expect(page).toContain('<TextInput')
    expect(page).toContain('placeholder="Your name"')
    expect(page).toContain('<Switch')
    expect(page).not.toContain('<div')
    expect(page).not.toContain('className=')
    expectValidTsx(page)
  })

  test('emits Expo Router pages and converts dynamic route segments', () => {
    const graph = new SceneGraph()
    const home = graph.getPages()[0]
    home.name = 'Home'
    const product = graph.addPage('Product')
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id' })
    graph.createNode('TEXT', home.id, { text: 'Home' })
    graph.createNode('TEXT', product.id, {
      text: 'Product',
      bindings: { text: { kind: 'expr', expr: '$params.id' } }
    })

    const output = compile({
      graph,
      pageIds: [home.id, product.id],
      options: expoOptions('expo-router')
    })
    const layout = textFile(output.files, 'app/_layout.tsx')
    const route = textFile(output.files, 'app/product/[id].tsx')
    const productPage = textFile(output.files, 'src/pages/product.tsx')

    expect(textFile(output.files, 'package.json')).toContain('"expo-router"')
    expect(layout).toContain("import { Stack } from 'expo-router'")
    expect(route).toContain("export { default } from '../../src/pages/product'")
    expect(productPage).toContain('useLocalSearchParams')
    expect(productPage).toContain('$params.id')
    expectValidTsx(layout)
    expectValidTsx(productPage)
  })

  test('keeps generated route files safe and preserves colliding pages for review', () => {
    const graph = new SceneGraph()
    const home = graph.getPages()[0]
    home.name = 'Home'
    const first = graph.addPage('First')
    const second = graph.addPage('Second')
    const unsafe = graph.addPage('Unsafe')
    const reserved = graph.addPage('Reserved')
    const layout = graph.addPage('Layout')
    const device = graph.addPage('Device')
    const caseVariant = graph.addPage('Case Variant')
    const deviceName = graph.addPage('CON')
    const foo = graph.addPage('Foo route')
    const fooIndex = graph.addPage('Foo index route')
    const longRoute = graph.addPage('L'.repeat(300))
    graph.updateNode(first.id, { lowcodeRoutePattern: '/same' })
    graph.updateNode(second.id, { lowcodeRoutePattern: '/same' })
    graph.updateNode(unsafe.id, { lowcodeRoutePattern: '/../escape' })
    graph.updateNode(reserved.id, { lowcodeRoutePattern: '/CONSTRUCTOR/detail' })
    graph.updateNode(layout.id, { lowcodeRoutePattern: '/_layout' })
    graph.updateNode(device.id, { lowcodeRoutePattern: '/CON/detail' })
    graph.updateNode(caseVariant.id, { lowcodeRoutePattern: '/Same' })
    graph.updateNode(foo.id, { lowcodeRoutePattern: '/foo' })
    graph.updateNode(fooIndex.id, { lowcodeRoutePattern: '/foo/index' })
    graph.updateNode(longRoute.id, { lowcodeRoutePattern: `/${'x'.repeat(300)}` })

    const output = compile({
      graph,
      pageIds: [
        home.id,
        first.id,
        second.id,
        unsafe.id,
        reserved.id,
        layout.id,
        device.id,
        caseVariant.id,
        deviceName.id,
        foo.id,
        fooIndex.id,
        longRoute.id
      ],
      options: withDefaults({
        ...expoOptions('expo-router'),
        packageName: '123_demo'
      })
    })
    const codes = output.warnings.map((warning) => warning.code)
    const appJSON = JSON.parse(textFile(output.files, 'app.json')) as {
      expo: { scheme: string }
    }

    expect(output.files.has('app/same.tsx')).toBe(true)
    expect(output.files.has('app/second.tsx')).toBe(true)
    expect(output.files.has('app/unsafe/escape.tsx')).toBe(true)
    expect(output.files.has('app/reserved/detail.tsx')).toBe(true)
    expect(output.files.has('app/layout.tsx')).toBe(true)
    expect(output.files.has('app/device/detail.tsx')).toBe(true)
    expect(output.files.has('app/case-variant.tsx')).toBe(true)
    expect(output.files.has('src/pages/page-con.tsx')).toBe(true)
    expect(output.files.has('app/page-con.tsx')).toBe(true)
    expect(output.files.has('app/foo.tsx')).toBe(true)
    expect(output.files.has('app/foo/index/index.tsx')).toBe(true)
    expect([...output.files.keys()].every((path) => !path.split('/').includes('..'))).toBe(true)
    expect(
      [...output.files.keys()].every((path) =>
        path.split('/').every((segment) => new TextEncoder().encode(segment).byteLength <= 255)
      )
    ).toBe(true)
    expect(appJSON.expo.scheme).toBe('openpencil-123-demo')
    expect(codes).toContain('expo-route-file-collision')
    expect(codes).toContain('expo-route-pattern-unsupported')
    expect(codes).toContain('expo-route-segment-truncated')
  })

  test('normalizes empty route segments and separates dynamic route-shape collisions', () => {
    const graph = new SceneGraph()
    const empty = graph.getPages()[0]
    empty.name = 'Empty route'
    const product = graph.addPage('Product')
    const article = graph.addPage('Article')
    graph.updateNode(empty.id, { lowcodeRoutePattern: '//' })
    graph.updateNode(product.id, { lowcodeRoutePattern: '/:id' })
    graph.updateNode(article.id, { lowcodeRoutePattern: '/:slug' })
    graph.createNode('BUTTON', product.id, {
      events: {
        onClick: [{ id: 'to-article', kind: 'navigate', to: '/:slug?tab=1#details' }]
      }
    })

    const output = compile({
      graph,
      pageIds: [empty.id, product.id, article.id],
      options: expoOptions('expo-router')
    })
    const productPage = textFile(output.files, 'src/pages/product.tsx')
    const codes = output.warnings.map((warning) => warning.code)

    expect(output.files.has('app/index.tsx')).toBe(true)
    expect(output.files.has('app/.tsx')).toBe(false)
    expect(output.files.has('app/[id].tsx')).toBe(true)
    expect(output.files.has('app/[slug].tsx')).toBe(false)
    expect(output.files.has('app/article.tsx')).toBe(true)
    expect(productPage).toContain('router.push("/article?tab=1#details");')
    expect(codes).toContain('expo-route-pattern-unsupported')
    expect(codes).toContain('expo-route-file-collision')
    expect(codes).toContain('route-collision')
  })

  test('fails closed for prototype-related dynamic route parameters', () => {
    const graph = new SceneGraph()
    const pages = [
      graph.getPages()[0],
      graph.addPage('Constructor parameter'),
      graph.addPage('Proto parameter')
    ]
    for (const [index, route] of ['/:prototype', '/:constructor', '/:__proto__'].entries()) {
      graph.updateNode(pages[index].id, { lowcodeRoutePattern: route })
    }

    const output = compile({
      graph,
      pageIds: pages.map((page) => page.id),
      options: expoOptions('expo-router')
    })
    const paths = [...output.files.keys()]
    const routeFiles = paths.filter(
      (path) => path.startsWith('app/') && path.endsWith('.tsx') && path !== 'app/_layout.tsx'
    )

    expect(paths.some((path) => /\[(?:prototype|constructor|__proto__)\]/i.test(path))).toBe(false)
    expect(routeFiles).toHaveLength(3)
    expect(
      output.warnings.filter((warning) => warning.code === 'expo-route-pattern-unsupported')
    ).toHaveLength(3)
  })

  test('copies local image bytes and references them with a native require', () => {
    const graph = makeSceneGraph('Gallery')
    const pageId = firstPageId(graph)
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    graph.images.set('hero-image', bytes)
    graph.createNode('RECTANGLE', pageId, {
      name: 'Hero',
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

    const output = compile({ graph, pageIds: [pageId], options: expoOptions() })
    const assetPath = 'assets/images/openpencil-image-hero-image.png'
    const page = textFile(output.files, 'src/pages/index.tsx')

    expect(output.files.get(assetPath)).toEqual(bytes)
    expect(page).toContain(`require("../../${assetPath}")`)
    expect(page).toContain('<ImageBackground')
    expect(page).toContain('resizeMode="contain"')
  })

  test('fails closed for unsafe, colliding, and unsupported local image assets', () => {
    const graph = makeSceneGraph('Asset safety')
    const pageId = firstPageId(graph)
    const pngA = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])
    const pngB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2])
    graph.images.set('a!', pngA)
    graph.images.set('a@', pngB)
    graph.images.set('vector', new TextEncoder().encode('<svg></svg>'))
    for (const hash of ['a!', 'a@', 'vector']) {
      graph.createNode('RECTANGLE', pageId, {
        name: hash,
        fills: [
          {
            type: 'IMAGE',
            imageHash: hash,
            imageScaleMode: 'FILL',
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true
          }
        ]
      })
    }
    graph.createNode('RECTANGLE', pageId, {
      name: 'Authored traversal',
      interactiveProps: { image: { src: './assets/../../package.json' } }
    })

    const output = compile({ graph, pageIds: [pageId], options: expoOptions() })
    const page = textFile(output.files, 'src/pages/index.tsx')
    const emittedPngs = [...output.files.keys()].filter(
      (path) => path.startsWith('assets/images/') && path.endsWith('.png')
    )
    const codes = output.warnings.map((warning) => warning.code)

    expect(emittedPngs).toHaveLength(2)
    expect(new Set(emittedPngs).size).toBe(2)
    expect(output.files.has('assets/images/openpencil-image-vector.svg')).toBe(false)
    expect(page).not.toContain('../../package.json')
    expect(codes).toContain('expo-image-asset-format-unsupported')
    expect(codes).toContain('expo-image-background-unavailable')
    expect(codes).toContain('expo-image-local-source-unavailable')
  })

  test('guards external links with a native scheme policy and rejection handling', () => {
    const graph = makeSceneGraph('Links')
    const pageId = firstPageId(graph)
    const unsafeLink = `java${'script'}:alert(1)`
    graph.createNode('FRAME', pageId, {
      interactiveProps: { href: unsafeLink }
    })

    const output = compile({ graph, pageIds: [pageId], options: expoOptions() })
    const page = textFile(output.files, 'src/pages/index.tsx')

    expect(page).toContain('Linking.canOpenURL(url)')
    expect(page).toContain('.catch(() => undefined)')
    expect(page).toContain(`__openPencilOpenExternalUrl(${JSON.stringify(unsafeLink)})`)
    expect(page).not.toContain(`Linking.openURL(${JSON.stringify(unsafeLink)})`)
    expect(output.warnings.map((warning) => warning.code)).toContain('expo-link-scheme-unsupported')
  })

  test('allocates component, prop, and import identifiers without native collisions', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 'card-state', name: 'Card', type: 'string', defaultValue: '' }]
    })
    const nativeMaster = graph.createNode('COMPONENT', page.id, { name: 'View' })
    graph.createNode('TEXT', nativeMaster.id, { text: 'Native reserved' })
    graph.createInstance(nativeMaster.id, page.id)
    const pageMaster = graph.createNode('COMPONENT', page.id, { name: 'Page Index' })
    graph.createNode('TEXT', pageMaster.id, { text: 'Page export reserved' })
    graph.createInstance(pageMaster.id, page.id)
    const cardMaster = graph.createNode('COMPONENT', page.id, { name: 'Card' })
    graph.createNode('TEXT', cardMaster.id, { text: 'State collision' })
    graph.createInstance(cardMaster.id, page.id)

    const output = compile({ graph, pageIds: [page.id], options: expoOptions() })
    const source = textFile(output.files, 'src/pages/index.tsx')

    expect(output.files.has('src/components/View2.tsx')).toBe(true)
    expect(source).toContain("import PageIndexComponent from '../components/PageIndex'")
    expect(source).toContain("import CardComponent from '../components/Card'")
    expect(source).toContain('<PageIndexComponent')
    expect(source).toContain('<CardComponent')
    expect(output.warnings.map((warning) => warning.code)).toContain(
      'expo-component-import-aliased'
    )
    expectValidTsx(source)
  })

  test('reserves fixed component props and drops colliding component doc-state locals', () => {
    const graph = new SceneGraph()
    const library = graph.getPages()[0]
    const use = graph.addPage('Use')
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'style-doc', name: 'style', type: 'string', defaultValue: 'x' },
        { id: 'test-id-doc', name: 'testID', type: 'string', defaultValue: 'node' },
        { id: 'theme-doc', name: 'theme', type: 'string', defaultValue: 'dark' }
      ]
    })
    const set = graph.createNode('COMPONENT_SET', library.id, { name: 'Variant Card' })
    const one = graph.createNode('COMPONENT', set.id, {
      name: 'style=One, testID=A, router=One, useDocState=Light'
    })
    graph.createNode('TEXT', one.id, {
      text: 'One',
      bindings: { text: { kind: 'docState', docStateName: 'style' } }
    })
    graph.createNode('TEXT', one.id, {
      text: 'Theme',
      bindings: { text: { kind: 'docState', docStateName: 'theme' } }
    })
    const two = graph.createNode('COMPONENT', set.id, {
      name: 'style=Two, testID=B, router=Two, useDocState=Dark'
    })
    graph.createNode('TEXT', two.id, { text: 'Two' })
    graph.createInstance(two.id, use.id)

    const runtimePropMaster = graph.createNode('COMPONENT', library.id, {
      name: 'Runtime Prop'
    })
    graph.createNode('TEXT', runtimePropMaster.id, { name: 'router', text: 'Default' })
    const runtimePropInstance = graph.createInstance(runtimePropMaster.id, use.id)
    const runtimePropChild = runtimePropInstance && graph.getChildren(runtimePropInstance.id)[0]
    if (!runtimePropInstance || !runtimePropChild)
      throw new Error('Expected component instance child')
    graph.updateNode(runtimePropChild.id, { text: 'Override' })
    runtimePropInstance.overrides = { [`${runtimePropChild.id}:text`]: 'Override' }

    const output = compile({
      graph,
      pageIds: [use.id],
      options: expoOptions('expo-router')
    })
    const component = textFile(output.files, 'src/components/VariantCard.tsx')
    const runtimePropComponent = textFile(output.files, 'src/components/RuntimeProp.tsx')
    const codes = output.warnings.map((warning) => warning.code)

    expect(component).toContain('style?: StyleProp<ViewStyle>')
    expect(component).toContain('style2?: string')
    expect(component).toContain('testID2?: string')
    expect(component).toContain('router2?: string')
    expect(component).toContain('useDocState2?: string')
    expect(component).toContain(
      '{ style, testID, style2 = "One", testID2 = "A", router2 = "One", useDocState2 = "Light" }'
    )
    expect(component).toContain('const theme = useDocState<unknown>("theme")')
    expect(component).toContain('const router = useRouter()')
    expect(component).not.toContain('const style = useDocState')
    expect(component).not.toContain('const testID = useDocState')
    expect(runtimePropComponent).toContain('router2?: string')
    expect(runtimePropComponent).toContain('const router = useRouter()')
    expectValidTsx(runtimePropComponent)
    expect(codes).toContain('component-docstate-identifier-collision')
    expect(codes).toContain('binding-docstate-unknown-name')
    expectValidTsx(component)
  })

  test('keeps navigate actions on text and image-filled buttons interactive', () => {
    const graph = new SceneGraph()
    const home = graph.getPages()[0]
    home.name = 'Home'
    const next = graph.addPage('Next')
    graph.images.set('button-image', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    graph.createNode('BUTTON', home.id, {
      width: 240,
      height: 64,
      interactiveProps: { text: 'Image action' },
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'button-image',
          imageScaleMode: 'FILL',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      events: { onClick: [{ id: 'button-nav', kind: 'navigate', to: '/next' }] }
    })
    graph.createNode('TEXT', home.id, {
      text: 'Text action',
      events: { onClick: [{ id: 'text-nav', kind: 'navigate', to: '/next' }] }
    })

    const output = compile({
      graph,
      pageIds: [home.id, next.id],
      options: expoOptions('expo-router')
    })
    const page = textFile(output.files, 'src/pages/index.tsx')

    expect(page).toContain('<Pressable')
    expect(page).toContain('<Image pointerEvents="none"')
    expect(page.match(/router\.push\("\/next"\);/g)).toHaveLength(2)
    expectValidTsx(page)
  })

  test('emits native TTF/OTF loading and warns instead of loading WOFF', () => {
    const graph = makeSceneGraph('Fonts')
    const pageId = firstPageId(graph)
    graph.createNode('TEXT', pageId, {
      text: 'Font sample',
      fontFamily: 'Native Font',
      fontSize: 18
    })
    const fontManifest: CompilerFontManifest = {
      faces: [
        {
          family: 'Native Font',
          weight: 400,
          style: 'normal',
          format: 'truetype',
          path: 'src/assets/fonts/native-font.ttf',
          content: new Uint8Array([1, 2, 3]),
          licenseEvidence: { kind: 'verified_open', licenseIds: ['OFL-1.1'] }
        },
        {
          family: 'Web Font',
          weight: 400,
          style: 'normal',
          format: 'woff',
          path: 'src/assets/fonts/web-font.woff',
          content: new Uint8Array([4, 5, 6]),
          licenseEvidence: { kind: 'verified_open', licenseIds: ['OFL-1.1'] }
        }
      ]
    }

    const output = compile({
      graph,
      pageIds: [pageId],
      fontManifest,
      options: expoOptions()
    })
    const fontLoader = textFile(output.files, 'src/generated-fonts.ts')
    const packageJSON = textFile(output.files, 'package.json')

    expect(output.files.get('assets/fonts/native-font.ttf')).toEqual(new Uint8Array([1, 2, 3]))
    expect(output.files.has('assets/fonts/web-font.woff')).toBe(false)
    expect(fontLoader).toContain("from 'expo-font'")
    expect(fontLoader).toContain('require("../assets/fonts/native-font.ttf")')
    expect(packageJSON).toContain('"expo-font"')
    expect(output.warnings.map((warning) => warning.code)).toContain('expo-font-format-unsupported')
  })

  test('reports web-only compiler options and unsupported controls explicitly', () => {
    const graph = makeSceneGraph('Unsupported')
    const pageId = firstPageId(graph)
    graph.createNode('SELECT', pageId, { interactiveProps: { options: ['A', 'B'] } })

    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        ...expoOptions(),
        metadata: { customCss: '.card { backdrop-filter: blur(8px); }' },
        themeSwitch: true
      })
    })
    const codes = output.warnings.map((warning) => warning.code)
    const styleWarnings: CompileWarning[] = []
    translateExpoStyle('cursor-pointer', 'web-style', (warning) => styleWarnings.push(warning))

    expect(codes).toContain('expo-web-option-unsupported')
    expect(codes).toContain('expo-control-unsupported')
    expect(styleWarnings.map((warning) => warning.code)).toContain('expo-style-web-only')
  })

  test('drops malicious document-state identifiers before Expo source emission', () => {
    const graph = makeSceneGraph('Safe state')
    const pageId = firstPageId(graph)
    const malicious = 'value);globalThis.__openPencilInjected=true;('
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'malicious-state', name: malicious, type: 'string', defaultValue: '' }
      ]
    })
    graph.createNode('INPUT', pageId, {
      bindings: { value: { kind: 'docState', docStateName: malicious } }
    })

    const output = compile({ graph, pageIds: [pageId], options: expoOptions() })
    const page = textFile(output.files, 'src/pages/index.tsx')
    const codes = output.warnings.map((warning) => warning.code)

    expect(codes).toContain('docstate-invalid')
    expect(codes).toContain('binding-value-docstate-unknown-name')
    expect(page).not.toContain(malicious)
    expectValidTsx(page)
  })

  test('dispatches Flutter to its native source adapter', () => {
    const graph = makeSceneGraph('Flutter seam')
    const pageId = firstPageId(graph)

    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target: 'flutter', router: 'none', devMode: false })
    })

    expect(output.files.has('pubspec.yaml')).toBe(true)
    expect(output.files.has('lib/main.dart')).toBe(true)
    expect(output.warnings.map((warning) => warning.code)).not.toContain('target-not-implemented')
  })
})
