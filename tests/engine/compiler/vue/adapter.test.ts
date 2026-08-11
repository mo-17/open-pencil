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

describe('Vue compiler adapter', () => {
  test('emits a runnable Vue project with state, controlled input, actions, and image assets', () => {
    const graph = makeSceneGraph('Home')
    const pageId = firstPageId(graph)
    graph.updateNode(pageId, {
      state: [
        { id: 'count', name: 'count', type: 'number', defaultValue: 0 },
        { id: 'name', name: 'name', type: 'string', defaultValue: '' }
      ]
    })
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'message', name: 'message', type: 'string', defaultValue: 'Ready' }
      ]
    })
    graph.createNode('TEXT', pageId, {
      text: 'Unsafe </template><script>window.bad=1</script>'
    })
    graph.createNode('INPUT', pageId, {
      interactiveProps: { placeholder: 'Your name' },
      bindings: { value: { kind: 'ref', stateId: 'name' } }
    })
    graph.createNode('TEXT', pageId, {
      bindings: { text: { kind: 'docState', docStateName: 'message' } }
    })
    const button = graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Update' } })
    button.events = {
      onClick: [
        { id: 'increment', kind: 'setState', targetStateId: 'count', valueExpr: 'count + 1' },
        {
          id: 'document-message',
          kind: 'setVariable',
          targetName: 'message',
          valueExpr: '"Updated"'
        }
      ]
    }
    const imageBytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )
    graph.images.set('vue-image', imageBytes)
    graph.createNode('RECTANGLE', pageId, {
      width: 120,
      height: 80,
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'vue-image',
          imageScaleMode: 'FIT',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    graph.createNode('RECTANGLE', pageId, {
      width: 120,
      height: 80,
      interactiveProps: {
        image: {
          src: './assets/openpencil-image-vue-image.png',
          alt: 'Bundled image',
          objectFit: 'contain'
        }
      }
    })
    const fontBytes = new Uint8Array([0, 1, 0, 0, 100, 101, 109, 111])
    const fontManifest: CompilerFontManifest = {
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

    const output = compile({ graph, pageIds: [pageId], options: vueOptions(), fontManifest })
    const page = textFile(output.files, 'src/pages/index.vue')
    const packageJson = JSON.parse(textFile(output.files, 'package.json')) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    const assetPath = [...output.files.keys()].find((path) =>
      path.startsWith('src/assets/openpencil-image-')
    )

    expect(output.warnings.map((warning) => warning.code)).not.toContain('target-not-implemented')
    expect(packageJson.dependencies.vue).toBeDefined()
    expect(packageJson.scripts.build).toContain('vue-tsc')
    expect(page).toContain('__vueRef<number>(0)')
    expect(page).toContain('__vueRef<string>("")')
    expect(page).toMatch(/:value="__opState_name_[a-z0-9]+"/)
    expect(page).toContain('.value = (__opEvent.target as HTMLInputElement).value')
    expect(page).toMatch(/__opState_count_[a-z0-9]+\.value = __opState_count_[a-z0-9]+\.value \+ 1/)
    expect(page).toContain('__setDocState("message", "Updated")')
    expect(page).toContain('&lt;/template&gt;&lt;script&gt;')
    expect(page).not.toContain('<script>window.bad=1</script>')
    expect(assetPath).toBeDefined()
    expect(output.files.get(assetPath as string)).toEqual(imageBytes)
    expect(page).toContain('src="../assets/openpencil-image-vue-image.png"')
    expect(output.files.get('src/assets/fonts/demo.ttf')).toEqual(fontBytes)
    expectValidSfc(page)
    maybeWriteVerificationProject(output.files)
  })

  test('imports image URLs used by token-bound multi-layer inline backgrounds', () => {
    const graph = makeSceneGraph('Home')
    const homeId = firstPageId(graph)
    const detail = graph.addPage('Detail')
    graph.updateNode(detail.id, { lowcodeRoutePattern: '/detail/:id' })
    graph.addCollection({
      id: 'theme',
      name: 'Theme',
      modes: [{ modeId: 'default', name: 'Default' }],
      defaultModeId: 'default',
      variableIds: ['accent']
    })
    graph.addVariable({
      id: 'accent',
      name: 'color/accent',
      type: 'COLOR',
      collectionId: 'theme',
      valuesByMode: { default: { r: 0.2, g: 0.4, b: 0.8, a: 1 } },
      description: '',
      hiddenFromPublishing: false
    })
    const imageBytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )
    graph.images.set('bound-background', imageBytes)
    const rectangle = graph.createNode('RECTANGLE', detail.id, {
      width: 160,
      height: 90,
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'bound-background',
          imageScaleMode: 'FIT',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        },
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 0.4 },
          opacity: 1,
          visible: true
        }
      ]
    })
    graph.bindVariable(rectangle.id, 'fills/1/color', 'accent')
    const master = graph.createNode('COMPONENT', detail.id, {
      name: 'Bound Card',
      width: 160,
      height: 90
    })
    graph.createNode('RECTANGLE', master.id, {
      name: 'Bound Artwork',
      width: 160,
      height: 90,
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'bound-background',
          imageScaleMode: 'FIT',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        },
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 0.4 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const instance = graph.createInstance(master.id, detail.id)
    if (!instance) throw new Error('instance not created')
    const instanceChild = graph.getChildren(instance.id)[0]
    graph.bindVariable(instanceChild.id, 'fills/1/color', 'accent')
    instance.overrides = { [`${instanceChild.id}:fills`]: true }

    const output = compile({
      graph,
      pageIds: [homeId, detail.id],
      options: vueOptions('vue-router-v4')
    })
    const page = textFile(output.files, 'src/pages/detail.vue')
    const assetPath = [...output.files.keys()].find((path) =>
      path.startsWith('src/assets/openpencil-image-bound-background')
    )

    expect(assetPath).toBeDefined()
    expect(output.files.get(assetPath as string)).toEqual(imageBytes)
    expect(page).toMatch(
      /import __opAsset_[A-Za-z0-9_$]+ from "\.\.\/assets\/openpencil-image-bound-background\.png"/
    )
    expect(page).toMatch(/const __opStyle_[0-9]+ = \{ "backgroundImage": .*__opAsset_/)
    expect(page).toMatch(/:style="__opStyle_[0-9]+"/)
    expect(page).toMatch(/:__opProp_[A-Za-z0-9_$]+="__opStyle_[0-9]+"/)
    expect(textFile(output.files, 'src/components/BoundCard.vue')).toContain(
      'Record<string, string>'
    )
    expectValidSfc(page)
    maybeWriteSafetyVerificationProject(output.files)
  })

  test('emits component refs, variant components, and vue-router v4 pages', () => {
    const component: ComponentDef = {
      componentId: 'component-card',
      name: 'Card',
      children: [],
      props: [],
      variantAxes: [
        { name: 'tone', rawName: 'Tone', options: ['Default', 'Danger'], defaultValue: 'Default' }
      ],
      variants: [
        { key: 'Default', children: [element({ children: [{ kind: 'text', value: 'Default' }] })] },
        { key: 'Danger', children: [element({ children: [{ kind: 'text', value: 'Danger' }] })] }
      ]
    }
    const home = minimalIr({
      pageId: 'home',
      pageName: 'Home',
      children: [
        {
          kind: 'componentRef',
          sourceId: 'card-instance',
          name: 'Card',
          className: 'w-40',
          props: [{ name: 'tone', kind: 'variant', value: 'Danger' }]
        }
      ]
    })
    const detail = minimalIr({
      pageId: 'detail',
      pageName: 'Detail',
      routePattern: '/detail/:id',
      usesRouteParams: true,
      children: [
        element({
          tag: 'button',
          events: {
            onClick: [
              {
                kind: 'navigate',
                to: '/',
                params: []
              }
            ]
          }
        })
      ]
    })
    const output = vueAdapter.emit([home, detail], vueOptions('vue-router-v4'), [component])
    const router = textFile(output.files, 'src/router.ts')
    const homePage = textFile(output.files, 'src/pages/index.vue')
    const componentFile = textFile(output.files, 'src/components/Card.vue')

    expect(textFile(output.files, 'package.json')).toContain('"vue-router"')
    expect(router).toContain("from 'vue-router'")
    expect(router).toContain('path: "/detail/:id"')
    expect(homePage).toMatch(/import OpenPencilCard[a-z0-9]+ from '\.\.\/components\/Card\.vue'/)
    expect(homePage).toMatch(
      /<OpenPencilCard[a-z0-9]+ class="w-40" __opProp_tone_[a-z0-9]+="Danger" \/>/
    )
    expect(componentFile).toMatch(
      /const __variantKey = __vueComputed\(\(\) => \[__opProp_tone_[a-z0-9]+\.value\]\.join\('\|'\)\)/
    )
    expect(componentFile).toContain('v-if="__variantKey === &quot;Danger&quot;"')
    expect(componentFile).toContain('<template v-else>')
    expect(componentFile.indexOf('Danger')).toBeLessThan(componentFile.lastIndexOf('Default'))
    expectValidSfc(homePage)
    expectValidSfc(componentFile)
  })

  test('aliases custom components away from Vue built-in component names', () => {
    const teleport: ComponentDef = {
      componentId: 'custom-teleport',
      name: 'Teleport',
      props: [],
      children: [element({ children: [{ kind: 'text', value: 'Custom teleport content' }] })]
    }
    const page = minimalIr({
      children: [
        {
          kind: 'componentRef',
          sourceId: 'teleport-instance',
          name: 'Teleport',
          className: '',
          props: []
        }
      ]
    })
    const output = vueAdapter.emit([page], vueOptions(), [teleport])
    const pageFile = textFile(output.files, 'src/pages/index.vue')
    const templateCode = compileVueTemplate(pageFile)

    expect(pageFile).toMatch(
      /import OpenPencilTeleport[a-z0-9]+ from '\.\.\/components\/Teleport\.vue'/
    )
    expect(pageFile).toMatch(/<OpenPencilTeleport[a-z0-9]+ \/>/)
    expect(pageFile).not.toContain('<Teleport')
    expect(templateCode).not.toContain('Teleport as _Teleport')
    expect(textFile(output.files, 'src/components/Teleport.vue')).toContain(
      'Custom teleport content'
    )
  })

  test('keeps authored text and expression fallbacks out of Vue template syntax', () => {
    const staticPayload = '{{ ({}).constructor.constructor("globalThis.__STATIC_PWN=1")() }}'
    const fallbackPayload = '}}<img src=x onerror="globalThis.__FALLBACK_PWN=1"><script>x</script>'
    const quasiPayload = 'prefix }}<img src=x onerror="globalThis.__QUASI_PWN=1">'
    const output = vueAdapter.emit(
      [
        minimalIr({
          states: [{ id: 'value', name: 'value', type: 'string', defaultValue: 'ok' }],
          children: [
            { kind: 'text', value: staticPayload },
            {
              kind: 'expression',
              ast: { kind: 'string', value: 'safe' },
              references: [],
              fallback: fallbackPayload
            },
            {
              kind: 'expression',
              ast: {
                kind: 'template',
                quasis: [quasiPayload, '</script>'],
                expressions: [{ kind: 'ident', name: 'value' }]
              },
              references: ['value']
            }
          ]
        })
      ],
      vueOptions()
    )
    const page = textFile(output.files, 'src/pages/index.vue')
    const templateCode = compileVueTemplate(page)

    expect(page).toContain('&#123;&#123; (&#123;&#125;).constructor.constructor')
    expect(page).toContain('{{ __opTextExpr_1 }}')
    expect(page).toContain('{{ __opTextExpr_2 }}')
    expect(page).not.toContain('{{ "safe" ??')
    expect(page).not.toContain('</script>\n</script>')
    expect(templateCode).not.toContain('_toDisplayString(({}).constructor')
    expect(templateCode).not.toContain('__FALLBACK_PWN')
    expect(templateCode).not.toContain('__QUASI_PWN')
    expect(templateCode).not.toContain('createElementVNode("img"')
  })

  test('blocks unsafe literal links and sanitizes dynamic links at runtime', () => {
    const links = [
      ['java', 'script:globalThis.__LINK_PWN=1'].join(''),
      'data:text/html,<script>globalThis.__DATA_PWN=1</script>',
      '//evil.example/path',
      'https://safe.example/\nheader'
    ]
    const output = vueAdapter.emit(
      [
        minimalIr({
          docStates: [{ id: 'link', name: 'linkTarget', type: 'string', defaultValue: '/safe' }],
          docStateReads: ['linkTarget'],
          children: [
            ...links.map((href, index) =>
              element({
                sourceId: `unsafe-${index}`,
                link: { hrefLiteral: href, target: '_self' },
                children: [{ kind: 'text', value: `Unsafe ${index}` }]
              })
            ),
            element({
              sourceId: 'safe-root',
              link: { hrefLiteral: ' /safe ', target: '_self' },
              children: [{ kind: 'text', value: 'Safe' }]
            }),
            element({
              sourceId: 'dynamic',
              link: {
                hrefExpr: { kind: 'ident', name: 'linkTarget' },
                target: '_blank'
              },
              children: [{ kind: 'text', value: 'Dynamic' }]
            })
          ]
        })
      ],
      vueOptions()
    )
    const page = textFile(output.files, 'src/pages/index.vue')
    const codes = output.warnings.map((warning) => warning.code)

    expect(codes).toContain('vue-link-href-unsafe')
    expect(codes).toContain('vue-link-href-runtime-sanitized')
    expect(page).not.toContain(['java', 'script:'].join(''))
    expect(page).not.toContain('data:text/html')
    expect(page).not.toContain('//evil.example')
    expect(page).toContain('href="/safe"')
    expect(page).toMatch(/:href="__safeHref\(__opDoc_linkTarget_[a-z0-9]+\)"/)
    expect(page).toContain("['http:', 'https:', 'mailto:', 'tel:']")
    expect(page).toContain("href.startsWith('/') || href.startsWith('#') || href.startsWith('?')")
    expectValidSfc(page)
  })
})
