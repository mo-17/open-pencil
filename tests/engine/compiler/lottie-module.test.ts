import { describe, expect, test } from 'bun:test'

import {
  LOTTIE_REACT_MODULE_ADAPTER,
  LOTTIE_WEB_VERSION,
  buildOpenPencilLottieComponent
} from '#compiler/adapters/react/modules/lottie'
import { LOTTIE_COMPILER_MODULE_LOWERER } from '#compiler/modules/lottie'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { createLottieModuleInstance } from '#core/plugins/lottie'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

interface LottiePayloadData {
  layers: unknown[]
}

function lottieData() {
  return {
    v: '5.13.0',
    fr: 60,
    ip: 0,
    op: 120,
    w: 360,
    h: 360,
    layers: [{ ty: 4, nm: 'Safe vector' }]
  }
}

describe('compiler trusted Lottie module adapter', () => {
  test('lowers only a validated FRAME module to a defensive data payload', () => {
    const data = lottieData()
    const instance = createLottieModuleInstance({
      source: 'json',
      data,
      autoplay: true,
      loop: false,
      speed: 1.25,
      direction: 'reverse',
      fit: 'cover'
    })
    const frame = createDefaultNode(() => 'lottie-frame', 'FRAME')
    const result = LOTTIE_COMPILER_MODULE_LOWERER.lower(instance, frame)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.payload).toEqual({
      source: 'json',
      url: '',
      data,
      autoplay: true,
      loop: false,
      speed: 1.25,
      direction: 'reverse',
      fit: 'cover'
    })
    data.layers.push({ ty: 4, nm: 'Mutation' })
    expect((result.payload.data as LottiePayloadData).layers).toHaveLength(1)

    expect(
      LOTTIE_COMPILER_MODULE_LOWERER.lower(
        {
          ...instance,
          config: { ...instance.config, data: { ...lottieData(), script: 'execute()' } }
        },
        frame
      )
    ).toMatchObject({ ok: false, reason: expect.stringContaining('unsupported top-level key') })
  })

  test('registers the lowerer/runtime in a compiled React project only when reachable', () => {
    const graph = makeSceneGraph('Lottie compiler integration')
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 360,
      height: 360,
      interactiveProps: {
        module: createLottieModuleInstance({ source: 'json', data: lottieData() })
      }
    })
    graph.createNode('TEXT', frame.id, { text: 'Authored Lottie fallback' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toMatchObject({
      pluginId: 'open-pencil.lottie',
      moduleType: 'lottie',
      configVersion: 1,
      payload: { source: 'json' }
    })

    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'lottie-module-integration' })
    })
    const app = output.files.get('src/App.tsx') as string
    const runtime = output.files.get('src/__openpencil_lottie.tsx') as string
    const packageJson = JSON.parse(output.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilLottie from './__openpencil_lottie'")
    expect(app).toContain('<OpenPencilLottie config={{')
    expect(app).toContain('Authored Lottie fallback')
    expect(runtime).toContain('Load Lottie animation')
    expect(packageJson.dependencies['lottie-web']).toBe(LOTTIE_WEB_VERSION)
    expect(output.warnings).toEqual([])
  })

  test('emits an expression-free SVG runtime with explicit network activation and bounded fetch', () => {
    const runtime = buildOpenPencilLottieComponent()

    expect(LOTTIE_WEB_VERSION).toBe('5.13.0')
    expect(LOTTIE_REACT_MODULE_ADAPTER.dependencies).toEqual({ 'lottie-web': '5.13.0' })
    expect(LOTTIE_REACT_MODULE_ADAPTER.optimizeDeps).toEqual(['lottie-web'])
    expect(runtime).toContain("from 'lottie-web/build/player/lottie_light'")
    expect(runtime).toContain('Load Lottie animation')
    expect(runtime).toContain('onClick={requestNetworkAnimation}')
    expect(runtime).toContain("credentials: 'omit'")
    expect(runtime).toContain("redirect: 'error'")
    expect(runtime).toContain("referrerPolicy: 'no-referrer'")
    expect(runtime).toContain("mode: 'cors'")
    expect(runtime).toContain('response.body.getReader()')
    expect(runtime).toContain('total > LIMITS.dataBytes')
    expect(runtime).toContain("new TextDecoder('utf-8', { fatal: true })")
    expect(runtime).toContain('validateAnimationData(JSON.parse(source))')
    expect(runtime).toContain('animationData: structuredClone(data)')
    expect(runtime).toContain("renderer: 'svg'")
    expect(runtime).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    expect(runtime).toContain('animation?.destroy()')
    expect(runtime).toContain('controller.abort()')
    expect(runtime).toContain('const cleanup = () => {')
    expect(runtime).toContain('} finally {\n        container.replaceChildren()')
    expect(runtime).toContain('return cleanup')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(runtime).not.toContain('<iframe')
    expect(runtime).not.toContain('<script')
  })

  test('emitted TSX is syntactically valid without resolving its generated-project dependency', async () => {
    const transpiler = new Bun.Transpiler({ loader: 'tsx', target: 'browser' })
    const output = await transpiler.transform(buildOpenPencilLottieComponent())

    expect(output).toContain('function OpenPencilLottie')
    expect(output).toContain('fetchBoundedAnimationData')
  })
})
