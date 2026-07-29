import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import type { MotionDriverSpecV1, MotionSpec } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function directMotion(trackId = 'progress'): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id: trackId,
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0, opacity: 0.4 },
          { offset: 1, x: 120, opacity: 1 }
        ],
        timing: { durationMs: 1_000, easing: 'linear', fill: 'both' }
      }
    ]
  }
}

function scrollDriver(sourceNodeId: string, targetNodeId: string): MotionDriverSpecV1 {
  return {
    version: 1,
    drivers: [
      {
        id: 'scroll-progress',
        source: { kind: 'scroll', sourceNodeId, axis: 'y', metric: 'progress' },
        target: { targetNodeId, trackId: 'progress' },
        mapping: { inputMin: 0, inputMax: 1 }
      }
    ]
  }
}

function compileDriversGraph() {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const owner = graph.createNode('FRAME', pageId, {
    name: 'Continuous motion owner',
    width: 320,
    height: 480
  })
  const source = graph.createNode('FRAME', owner.id, {
    name: 'Scroll source',
    width: 320,
    height: 240
  })
  const target = graph.createNode('RECTANGLE', owner.id, {
    name: 'Driven target',
    width: 40,
    height: 40,
    motion: directMotion()
  })
  graph.updateNode(owner.id, { motionDrivers: scrollDriver(source.id, target.id) })
  const files = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'motion-drivers', devMode: false })
  }).files
  return { files, owner, source, target }
}

describe('compiler — continuous Motion drivers', () => {
  test('lifts page-owned drivers onto the generated page wrapper', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const target = graph.createNode('RECTANGLE', pageId, { motion: directMotion() })
    graph.updateNode(pageId, {
      state: [{ id: 'progress', name: 'progress', type: 'number', defaultValue: 0 }],
      motionDrivers: {
        version: 1,
        drivers: [
          {
            id: 'page-state',
            source: { kind: 'pageState', stateId: 'progress' },
            target: { targetNodeId: target.id, trackId: 'progress' },
            mapping: { inputMin: 0, inputMax: 1 }
          }
        ]
      }
    })
    const files = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'page-motion-drivers', devMode: false })
    }).files
    const app = files.get('src/App.tsx') as string

    expect(app).toMatch(
      new RegExp(
        `<div className="relative min-h-screen" data-node-id="${pageId}" data-op-motion-drivers="d-[a-z0-9]+" data-op-motion-scope>`
      )
    )
    expect(files.get('src/__motion-runtime.ts') as string).toContain('page-state')
    expect(app).toContain('setPageState("progress", progress)')
    expect(app).toContain('useEffect')
  })

  test('drops unresolved or non-scalar state sources with a compiler warning', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const target = graph.createNode('RECTANGLE', pageId, { motion: directMotion() })
    graph.updateNode(pageId, {
      state: [{ id: 'label', name: 'label', type: 'string', defaultValue: '' }],
      motionDrivers: {
        version: 1,
        drivers: [
          {
            id: 'unsupported-state',
            source: { kind: 'pageState', stateId: 'label' },
            target: { targetNodeId: target.id, trackId: 'progress' },
            mapping: { inputMin: 0, inputMax: 1 }
          }
        ]
      }
    })
    const result = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'invalid-motion-driver', devMode: false })
    })

    expect(result.warnings.some(({ code }) => code === 'motion-drivers-invalid')).toBe(true)
    expect(result.files.get('src/App.tsx') as string).not.toContain('data-op-motion-drivers')
  })

  test('loads and bridges document state even when no UI action reads or writes it', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'doc-progress', name: 'documentProgress', type: 'number', defaultValue: 0.2 }
      ]
    })
    const target = graph.createNode('RECTANGLE', pageId, { motion: directMotion() })
    graph.updateNode(pageId, {
      motionDrivers: {
        version: 1,
        drivers: [
          {
            id: 'document-state',
            source: { kind: 'documentState', stateId: 'doc-progress' },
            target: { targetNodeId: target.id, trackId: 'progress' },
            mapping: { inputMin: 0, inputMax: 1 }
          }
        ]
      }
    })
    const files = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'document-motion-driver', devMode: false })
    }).files

    expect(files.get('src/App.tsx') as string).toContain("import './_lowcode_state'")
    expect(files.get('src/_lowcode_state.ts') as string).toContain(
      'notifyDocumentMotionDriver("doc-progress", state.documentProgress)'
    )
  })

  test('emits production markers and the bounded browser runtime', () => {
    const { files, owner, source, target } = compileDriversGraph()
    const app = files.get('src/App.tsx') as string
    const runtime = files.get('src/__motion-runtime.ts') as string

    expect(app).toContain(`data-node-id="${owner.id}"`)
    expect(app).toContain(`data-node-id="${source.id}"`)
    expect(app).toContain(`data-node-id="${target.id}"`)
    expect(app).toMatch(/data-op-motion-drivers="d-[a-z0-9]+" data-op-motion-scope/)
    expect(runtime).toContain('const motionDriverRegistry: Record<string, MotionDriverSpec>')
    expect(runtime).toContain("kind: 'scroll'")
    expect(runtime).toContain('requestAnimationFrame(flushMotionDriverInputs)')
    expect(runtime).toContain('automaticStopped.get(element)')
    expect(runtime).toContain(
      'const controlledProgress = new WeakMap<Element, Map<string, number>>()'
    )
    expect(runtime).toContain('restoreControlledTrackProgress(element, trackId, progress)')
    expect(runtime).toContain('controlledProgress.has(element)')
    expect(runtime).toContain('const refreshedSpec = specFor(element)')
    expect(runtime).toContain(
      'controlledProgressByTrack: new Map(controlledProgress.get(element) ?? [])'
    )
    expect(runtime).toContain('forgetControlledTrackProgress(element, trackId)')
    expect(runtime).toContain('__OPENPENCIL_MOTION_DRIVERS__')
    expect(runtime).toContain('setPageState(stateId: string, value: number | boolean): number')
    expect(runtime).toContain('setDocumentState(stateId: string, value: number | boolean): number')
    expect(runtime).toContain('setVariable(variableId: string, value: number | boolean): number')
    expect(runtime).toContain('unmountMotionDriverTree')
  })

  test('keeps component-instance driver lookup inside each generated scope', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Continuous Card',
      width: 180,
      height: 100
    })
    const source = graph.createNode('FRAME', master.id, {
      name: 'Pointer region',
      width: 180,
      height: 100
    })
    const target = graph.createNode('RECTANGLE', master.id, {
      name: 'Indicator',
      width: 24,
      height: 24,
      motion: directMotion()
    })
    graph.updateNode(master.id, { motionDrivers: scrollDriver(source.id, target.id) })
    const instance = graph.createInstance(master.id, pageId)
    if (!instance) throw new Error('Expected component instance')

    const files = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-driver-scope', devMode: false })
    }).files
    const app = files.get('src/App.tsx') as string
    const component = files.get('src/components/ContinuousCard.tsx') as string

    expect(app).toMatch(/<ContinuousCard[^>]*__opMotionDriversKey="d-[a-z0-9]+"/)
    expect(app).toMatch(/<ContinuousCard[^>]*__opNodeId=/)
    expect(component).toContain('__opMotionDriversKey?: string')
    expect(component).toContain('data-op-motion-drivers={__opMotionDriversKey}')
    expect(component).toContain('data-op-motion-scope')
    expect(component).toContain(`data-node-id="${source.id}"`)
    expect(component).toContain(`data-node-id="${target.id}"`)
  })
})

const buildDir = mkdtempSync(join(tmpdir(), 'op-motion-drivers-build-'))

afterAll(() => {
  rmSync(buildDir, { recursive: true, force: true })
})

test('compiled continuous-driver project completes a real Vite build', async () => {
  const { files } = compileDriversGraph()
  const result = await buildPreviewProject({ files, outDir: buildDir })
  expect(result.files).toContain('index.html')
  expect(result.files.some((file) => file.endsWith('.js'))).toBe(true)
}, 30_000)
