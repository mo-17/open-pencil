import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import {
  createUserMotionPreset,
  createUserMotionPresetLibrary,
  instantiateUserMotionPreset,
  removeUserMotionPreset,
  type MotionSpec,
  type MotionTrack
} from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function track(
  id: string,
  trigger: MotionTrack['trigger'],
  keyframes: MotionTrack['keyframes'],
  durationMs = 200
): MotionTrack {
  return { id, trigger, keyframes, timing: { durationMs } }
}

function spec(
  tracks: MotionTrack[],
  reducedMotion: MotionSpec['reducedMotion'] = 'allow'
): MotionSpec {
  return { version: 1, tracks, reducedMotion }
}

function compileGraph(
  graph: ReturnType<typeof makeSceneGraph>,
  pageIds = [firstPageId(graph)],
  extra: Parameters<typeof withDefaults>[0] = {}
) {
  return compile({
    graph,
    pageIds,
    options: withDefaults({ packageName: 'motion-test', devMode: false, ...extra })
  })
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('compiler — MotionSpec v1 artifacts', () => {
  test('personal preset snapshots emit the same token, CSS, and runtime after library deletion', () => {
    const directMotion = spec(
      [
        track(
          'enter',
          'mount',
          [
            { offset: 0, opacity: 0, y: 10 },
            { offset: 1, opacity: 1, y: 0 }
          ],
          360
        ),
        track(
          'hover',
          'hover',
          [
            { offset: 0, scaleX: 1, scaleY: 1 },
            { offset: 1, scaleX: 1.05, scaleY: 1.05 }
          ],
          180
        )
      ],
      'reduce'
    )
    let library = createUserMotionPresetLibrary()
    library = createUserMotionPreset(library, {
      id: 'user-artifact-parity',
      name: '编译产物等价',
      description: 'CSS、runtime 与 token 不依赖本地预设库',
      category: 'custom',
      motion: directMotion
    })
    const saved = library.presets[0]
    if (!saved) throw new Error('Expected personal motion preset')
    const appliedSnapshot = instantiateUserMotionPreset(saved)

    const directGraph = makeSceneGraph()
    const directNode = directGraph.createNode('BUTTON', firstPageId(directGraph), {
      name: 'Direct',
      motion: directMotion
    })
    const snapshotGraph = makeSceneGraph()
    const snapshotNode = snapshotGraph.createNode('BUTTON', firstPageId(snapshotGraph), {
      name: 'Personal preset snapshot',
      motion: appliedSnapshot
    })
    expect(directNode.motion?.preset).toBeUndefined()
    expect(snapshotNode.motion?.preset).toEqual({
      id: saved.id,
      version: saved.revision,
      parameters: {}
    })

    library = removeUserMotionPreset(library, saved.id)
    expect(library.presets).toEqual([])
    expect(snapshotGraph.getNode(snapshotNode.id)?.motion).toEqual(appliedSnapshot)

    const directOut = compileGraph(directGraph)
    const snapshotOut = compileGraph(snapshotGraph)
    const directApp = directOut.files.get('src/App.tsx') as string
    const snapshotApp = snapshotOut.files.get('src/App.tsx') as string
    const directToken = /data-op-motion="([^"]+)"/.exec(directApp)?.[1]
    const snapshotToken = /data-op-motion="([^"]+)"/.exec(snapshotApp)?.[1]
    expect(directToken).toBeDefined()
    expect(snapshotToken).toBe(directToken)
    expect(snapshotOut.files.get('src/__motion.css')).toBe(directOut.files.get('src/__motion.css'))
    expect(snapshotOut.files.get('src/__motion-runtime.ts')).toBe(
      directOut.files.get('src/__motion-runtime.ts')
    )
  })

  test('no-motion output has no IR residue, artifact, import, or dependency', () => {
    const base = makeSceneGraph()
    base.createNode('RECTANGLE', firstPageId(base), { width: 40, height: 40 })
    const explicit = makeSceneGraph()
    explicit.createNode('RECTANGLE', firstPageId(explicit), {
      width: 40,
      height: 40,
      motion: undefined
    })

    const a = compileGraph(base)
    const b = compileGraph(explicit)
    expect([...a.files]).toEqual([...b.files])
    expect(a.files.has('src/__motion.css')).toBe(false)
    expect(a.files.has('src/__motion-runtime.ts')).toBe(false)
    expect(a.files.get('src/main.tsx') as string).not.toContain('__motion')
    expect(a.files.get('src/App.tsx') as string).not.toContain('data-op-motion')
    const pkg = JSON.parse(a.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies).some((name) => name.includes('motion'))).toBe(false)
  })

  test('mount/loop emit deduped CSS comma lists with individual transform properties', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const motion = spec([
      track('slide', 'mount', [
        { offset: 0, x: -16 },
        { offset: 1, x: 0 }
      ]),
      track(
        'spin',
        'loop',
        [
          { offset: 0, rotate: 0 },
          { offset: 1, rotate: 360 }
        ],
        800
      )
    ])
    graph.createNode('RECTANGLE', pageId, { motion })
    graph.createNode('RECTANGLE', pageId, {
      motion: {
        ...motion,
        preset: { id: 'custom-enter', version: 1, parameters: { durationMs: 200 } }
      }
    })

    const out = compileGraph(graph)
    const app = out.files.get('src/App.tsx') as string
    const css = out.files.get('src/__motion.css') as string
    const main = out.files.get('src/main.tsx') as string
    expect(out.files.has('src/__motion-runtime.ts')).toBe(false)
    expect(count(app, 'data-op-motion=')).toBe(2)
    expect(
      new Set([...app.matchAll(/data-op-motion="([^"]+)"/g)].map((match) => match[1])).size
    ).toBe(1)
    expect(count(css, '@keyframes ')).toBe(2)
    expect(css).toMatch(/animation-name: [^,]+, [^;]+;/)
    expect(css).toContain('translate: -16px 0px')
    expect(css).toContain('rotate: 360deg')
    expect(css).not.toContain('transform:')
    expect(count(main, "import './__motion.css'")).toBe(1)
    expect(main).not.toContain('__motion-runtime')
  })

  test('devMode installs the inspectable runtime for CSS-only MotionSpec entries', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      motion: spec([
        track('enter', 'mount', [
          { offset: 0, opacity: 0, y: 8 },
          { offset: 1, opacity: 1, y: 0 }
        ])
      ])
    })

    const out = compileGraph(graph, [pageId], { devMode: true })
    const runtime = out.files.get('src/__motion-runtime.ts') as string
    const main = out.files.get('src/main.tsx') as string
    expect(out.files.has('src/__motion.css')).toBe(true)
    expect(runtime).toContain('inspect: (targetNodeId?: string, scope?: Element)')
    expect(runtime).toContain(
      "type MotionDebugSource = 'automatic' | 'controlled' | 'idle' | 'stopped'"
    )
    expect(runtime).toContain('const runtimeTokens = new Set<string>([])')
    expect(main).toContain("import './__motion.css'")
    expect(main).toContain("import './__motion-runtime'")
  })

  test('interactive triggers emit only the delegated zero-dependency runtime', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, {
      motion: spec([
        track('hover', 'hover', [
          { offset: 0, scaleX: 1, scaleY: 1 },
          { offset: 1, scaleX: 1.05, scaleY: 1.05 }
        ]),
        track('press', 'press', [
          { offset: 0, scaleX: 1, scaleY: 1 },
          { offset: 1, scaleX: 0.95, scaleY: 0.95 }
        ]),
        track('focus', 'focus', [
          { offset: 0, opacity: 0.8 },
          { offset: 1, opacity: 1 }
        ]),
        track('click', 'click', [
          { offset: 0, rotate: 0 },
          { offset: 1, rotate: 8 }
        ]),
        track('view', 'inView', [
          { offset: 0, y: 12 },
          { offset: 1, y: 0 }
        ])
      ])
    })

    const out = compileGraph(graph)
    const runtime = out.files.get('src/__motion-runtime.ts') as string
    const main = out.files.get('src/main.tsx') as string
    expect(out.files.has('src/__motion.css')).toBe(false)
    expect(runtime).toContain("listen('pointerover'")
    expect(runtime).toContain("listen('pointerdown'")
    expect(runtime).toContain("event.key !== 'Enter' && event.key !== ' '")
    expect(runtime).toContain("listen('focusin'")
    expect(runtime).toContain("listen('click'")
    expect(runtime).toContain('IntersectionObserver')
    expect(runtime).toContain('MutationObserver')
    expect(runtime).toContain('/* Embedded from @open-pencil/motion-runtime/kernel. */')
    expect(runtime).toContain('const embeddedMotionKernel: EmbeddedMotionKernel')
    expect(runtime).not.toContain("from '@open-pencil/motion-runtime")
    expect(runtime).toContain('__OPENPENCIL_MOTION_RUNTIME__?.dispose()')
    expect(runtime).toContain('cancelAnimation(item.animation)')
    expect(runtime).toContain("animation.addEventListener('finish', release)")
    expect(runtime).toContain('inViewObserver?.unobserve(element)')
    expect(runtime).toContain('item.animation.reverse()')
    expect(runtime).not.toContain('eval(')
    expect(runtime).not.toContain('new Function')
    expect(runtime).not.toContain('innerHTML')
    expect(count(main, "import './__motion-runtime'")).toBe(1)
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies).some((name) => name.includes('motion'))).toBe(false)
  })

  test('mixed CSS/runtime output and reduced-motion policies stay aligned', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      motion: spec(
        [
          track(
            'mount',
            'mount',
            [
              { offset: 0, opacity: 0, x: -20 },
              { offset: 1, opacity: 1, x: 0 }
            ],
            500
          ),
          track(
            'click',
            'click',
            [
              { offset: 0, opacity: 0.5, scaleX: 0.9, scaleY: 0.9 },
              { offset: 1, opacity: 1, scaleX: 1, scaleY: 1 }
            ],
            500
          )
        ],
        'reduce'
      )
    })

    const out = compileGraph(graph)
    const css = out.files.get('src/__motion.css') as string
    const runtime = out.files.get('src/__motion-runtime.ts') as string
    const main = out.files.get('src/main.tsx') as string
    const reducedCss = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(main).toContain("import './__motion.css'")
    expect(main).toContain("import './__motion-runtime'")
    expect(reducedCss).toContain('animation-duration: 120ms')
    expect(reducedCss).not.toContain('translate:')
    expect(reducedCss).not.toContain('scale:')
    expect(runtime).toContain('Math.min(track.timing.duration, 120)')
    expect(runtime).toContain("if (policy === 'disable') return null")
  })

  test('disable policy suppresses both CSS and runtime animation under reduced motion', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, {
      motion: spec(
        [
          track('enter', 'mount', [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ]),
          track('hover', 'hover', [
            { offset: 0, scaleX: 1, scaleY: 1 },
            { offset: 1, scaleX: 1.05, scaleY: 1.05 }
          ])
        ],
        'disable'
      )
    })

    const out = compileGraph(graph)
    const css = out.files.get('src/__motion.css') as string
    const runtime = out.files.get('src/__motion-runtime.ts') as string
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation: none !important')
    expect(runtime).toContain('"reducedMotion":"disable"')
    expect(runtime).toContain("if (policy === 'disable') return null")
  })

  test('image, component body/ref, and shadcn composed roots retain motion boundaries', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const mount = spec([
      track('enter', 'mount', [
        { offset: 0, opacity: 0 },
        { offset: 1, opacity: 1 }
      ])
    ])
    const hover = spec([
      track('hover', 'hover', [
        { offset: 0, scaleX: 1, scaleY: 1 },
        { offset: 1, scaleX: 1.04, scaleY: 1.04 }
      ])
    ])
    graph.createNode('RECTANGLE', pageId, {
      motion: mount,
      interactiveProps: { image: { src: 'https://example.com/a.png', alt: 'A' } }
    })
    graph.createNode('CHECKBOX', pageId, { motion: hover })
    const master = graph.createNode('COMPONENT', pageId, { name: 'Motion Card', motion: hover })
    graph.createNode('TEXT', master.id, { text: 'Body', motion: mount })
    const instance = graph.createInstance(master.id, pageId)
    if (!instance) throw new Error('Expected component instance')
    expect(instance.motion).toEqual(hover)
    expect(instance.motion).not.toBe(master.motion)

    const out = compileGraph(graph, [pageId], { uiKit: 'shadcn' })
    const app = out.files.get('src/App.tsx') as string
    const component = out.files.get('src/components/MotionCard.tsx') as string
    expect(app).toMatch(/<img[^>]*data-node-id=/)
    expect(app).toMatch(/<img[^>]*data-op-motion=/)
    expect(app).toMatch(/<Checkbox[^>]*data-node-id=/)
    expect(app).toMatch(/<Checkbox[^>]*data-op-motion=/)
    expect(app).toMatch(/<MotionCard[^>]*__opMotionKey=/)
    expect(app).toMatch(/<MotionCard[^>]*__opNodeId=/)
    expect(component).toContain('__opMotionKey?: string')
    expect(component).toContain('__opNodeId?: string')
    expect(component).toContain('data-node-id={__opNodeId}')
    expect(component).toContain('data-op-motion={__opMotionKey}')
    expect(component).toMatch(/<p[^>]*data-op-motion=/)
  })

  test('multi-page projects import each global motion artifact exactly once', () => {
    const graph = makeSceneGraph('Home')
    const home = firstPageId(graph)
    const second = graph.addPage('Second').id
    const mixed = spec([
      track('enter', 'mount', [
        { offset: 0, x: -8 },
        { offset: 1, x: 0 }
      ]),
      track('tap', 'click', [
        { offset: 0, opacity: 0.7 },
        { offset: 1, opacity: 1 }
      ])
    ])
    graph.createNode('BUTTON', home, { motion: mixed })
    graph.createNode('BUTTON', second, { motion: mixed })

    const out = compileGraph(graph, [home, second])
    const main = out.files.get('src/main.tsx') as string
    expect(count(main, "import './__motion.css'")).toBe(1)
    expect(count(main, "import './__motion-runtime'")).toBe(1)
    expect(count(out.files.get('src/__motion.css') as string, '@keyframes ')).toBe(1)
  })
})

const buildDir = mkdtempSync(join(tmpdir(), 'op-motion-build-'))

afterAll(() => {
  rmSync(buildDir, { recursive: true, force: true })
})

test('compiled mixed-motion project completes a real Vite build', async () => {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.createNode('BUTTON', pageId, {
    motion: spec([
      track('enter', 'mount', [
        { offset: 0, opacity: 0, y: 8 },
        { offset: 1, opacity: 1, y: 0 }
      ]),
      track('tap', 'click', [
        { offset: 0, scaleX: 0.95, scaleY: 0.95 },
        { offset: 1, scaleX: 1, scaleY: 1 }
      ])
    ])
  })
  const out = compileGraph(graph)
  const result = await buildPreviewProject({ files: out.files, outDir: buildDir })
  expect(result.files).toContain('index.html')
  expect(result.files.some((file) => file.endsWith('.js'))).toBe(true)
  expect(result.files.some((file) => file.endsWith('.css'))).toBe(true)
}, 30_000)
