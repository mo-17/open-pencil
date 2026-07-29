import { beforeAll, describe, expect, test } from 'bun:test'

import { emitEventHandler } from '#compiler/adapters/react/emit/event'
import { collectTree } from '#compiler/ir/collect/tree'

import { compile, withDefaults } from '@open-pencil/compiler'
import { initCodec } from '@open-pencil/core'
import type { ActionDef, MotionSpec } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const MOTION: MotionSpec = {
  version: 1,
  reducedMotion: 'allow',
  tracks: [
    {
      id: 'enter',
      trigger: 'mount',
      keyframes: [
        { offset: 0, x: -12, opacity: 0 },
        { offset: 1, x: 0, opacity: 1 }
      ],
      timing: { durationMs: 180 }
    }
  ]
}

describe('compiler — low-code motion actions', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('collects playMotion/stopMotion with trimmed safe identifiers', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const target = graph.createNode('RECTANGLE', pageId, { motion: MOTION })
    const button = graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [
          {
            id: 'play',
            kind: 'playMotion',
            targetNodeId: `  ${target.id}  `,
            trackId: ' enter '
          },
          { id: 'stop', kind: 'stopMotion', targetNodeId: target.id }
        ]
      }
    })

    const ir = collectTree(graph, pageId)
    const element = ir.children.find(
      (child) => child.kind === 'element' && child.sourceId === button.id
    )
    if (element?.kind !== 'element') throw new Error('expected button element')
    expect(element.events?.onClick).toEqual([
      { kind: 'playMotion', targetNodeId: target.id, trackId: 'enter' },
      { kind: 'stopMotion', targetNodeId: target.id }
    ])
    expect(ir.warnings).toEqual([])
  })

  test('collects toggleMotion and awaitMotion as an async completion chain', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const baseTrack = MOTION.tracks[0]
    const target = graph.createNode('RECTANGLE', pageId, {
      motion: {
        ...MOTION,
        tracks: [{ ...baseTrack, id: 'page-exit', trigger: 'pageExit' }]
      }
    })
    const button = graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [
          { id: 'toggle', kind: 'toggleMotion', targetNodeId: target.id, trackId: 'page-exit' },
          {
            id: 'await',
            kind: 'awaitMotion',
            targetNodeId: target.id,
            trackId: 'page-exit',
            timeoutMs: 1_500,
            stopOnTimeout: true
          },
          { id: 'navigate', kind: 'navigate', to: '/next' }
        ]
      }
    })

    const ir = collectTree(graph, pageId)
    const element = ir.children.find(
      (child) => child.kind === 'element' && child.sourceId === button.id
    )
    if (element?.kind !== 'element') throw new Error('expected button element')
    expect(element.events?.onClick).toEqual([
      { kind: 'toggleMotion', targetNodeId: target.id, trackId: 'page-exit' },
      {
        kind: 'awaitMotion',
        targetNodeId: target.id,
        trackId: 'page-exit',
        timeoutMs: 1_500,
        stopOnTimeout: true
      },
      { kind: 'navigate', to: '/next' }
    ])
    expect(emitEventHandler(element.events?.onClick ?? [])).toContain(
      'await window.__OPENPENCIL_MOTION_RUNTIME__?.wait'
    )
    expect(emitEventHandler(element.events?.onClick ?? [])).toContain('navigate("/next")')
    expect(ir.warnings).toEqual([])
  })

  test('drops malformed persisted motion actions without throwing', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const malformed = JSON.parse(`[
      { "id": "bad-target", "kind": "playMotion", "targetNodeId": 42 },
      { "id": "bad-track", "kind": "stopMotion", "targetNodeId": "target", "trackId": "   " }
    ]`) as ActionDef[]
    graph.createNode('BUTTON', pageId, { events: { onClick: malformed } })

    const ir = collectTree(graph, pageId)
    expect(ir.warnings.map((warning) => warning.code)).toEqual([
      'action-play-motion-invalid-target',
      'action-stop-motion-invalid-track'
    ])
  })

  test('captures event scope for Motion calls with escaped static arguments', () => {
    expect(
      emitEventHandler([{ kind: 'playMotion', targetNodeId: 'node"1', trackId: 'bounce' }])
    ).toBe(
      '(e) => { const __opMotionScope = e.currentTarget; window.__OPENPENCIL_MOTION_RUNTIME__?.play("node\\\"1", "bounce", __opMotionScope); }'
    )
    expect(emitEventHandler([{ kind: 'stopMotion', targetNodeId: 'node-2' }])).toBe(
      '(e) => { const __opMotionScope = e.currentTarget; window.__OPENPENCIL_MOTION_RUNTIME__?.stop("node-2", undefined, __opMotionScope); }'
    )
    expect(emitEventHandler([{ kind: 'toggleMotion', targetNodeId: 'node-3' }])).toBe(
      '(e) => { const __opMotionScope = e.currentTarget; window.__OPENPENCIL_MOTION_RUNTIME__?.toggle("node-3", undefined, __opMotionScope); }'
    )
    expect(
      emitEventHandler([
        {
          kind: 'awaitMotion',
          targetNodeId: 'node-4',
          trackId: 'exit',
          timeoutMs: 800,
          stopOnTimeout: true
        }
      ])
    ).toBe(
      'async (e) => { const __opMotionScope = e.currentTarget; await window.__OPENPENCIL_MOTION_RUNTIME__?.wait("node-4", "exit", __opMotionScope, { timeoutMs: 800, stopOnTimeout: true }); }'
    )
    expect(
      emitEventHandler([
        {
          kind: 'setState',
          stateName: 'count',
          ast: { kind: 'number', value: 1 },
          references: [],
          mode: 'absolute'
        }
      ])
    ).toBe('() => setCount(1)')
  })

  test('threads component scope through nested motion action branches', () => {
    expect(
      emitEventHandler([
        {
          kind: 'condition',
          condAst: { kind: 'number', value: 1 },
          consequent: [{ kind: 'playMotion', targetNodeId: 'nested' }]
        }
      ])
    ).toBe(
      '(e) => { const __opMotionScope = e.currentTarget; if (1) { window.__OPENPENCIL_MOTION_RUNTIME__?.play("nested", undefined, __opMotionScope); } }'
    )
    expect(
      emitEventHandler([
        { kind: 'delay', ms: 10 },
        { kind: 'playMotion', targetNodeId: 'after-await' }
      ])
    ).toBe(
      'async (e) => { const __opMotionScope = e.currentTarget; await new Promise((resolve) => setTimeout(resolve, 10)); window.__OPENPENCIL_MOTION_RUNTIME__?.play("after-await", undefined, __opMotionScope); }'
    )
  })

  test('warns and emits a safe empty runtime when the target is unreachable', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [{ id: 'play', kind: 'playMotion', targetNodeId: 'external-instance' }]
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-action-no-target', devMode: false })
    })
    expect(out.files.has('src/__motion.css')).toBe(false)
    expect(out.files.get('src/__motion-runtime.ts')).toContain(
      'const registry: Record<string, MotionSpec> = {}'
    )
    expect(out.files.get('src/App.tsx')).toContain(
      'window.__OPENPENCIL_MOTION_RUNTIME__?.play("external-instance", undefined, __opMotionScope)'
    )
    expect(out.warnings.map((warning) => warning.code)).toContain(
      'action-play-motion-unreachable-target'
    )
  })

  test('warns for a target without Motion and a stale track id', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const plain = graph.createNode('RECTANGLE', pageId)
    const animated = graph.createNode('RECTANGLE', pageId, { motion: MOTION })
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [
          { id: 'plain', kind: 'playMotion', targetNodeId: plain.id },
          {
            id: 'stale',
            kind: 'stopMotion',
            targetNodeId: animated.id,
            trackId: 'removed-track'
          }
        ]
      }
    })

    const ir = collectTree(graph, pageId)
    expect(ir.warnings.map((warning) => warning.code)).toEqual([
      'action-play-motion-target-without-motion',
      'action-stop-motion-stale-track'
    ])
  })

  test('warns when an existing motion target is outside the current output page', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const otherPage = graph.addPage('Other')
    const otherTarget = graph.createNode('RECTANGLE', otherPage.id, { motion: MOTION })
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [
          { id: 'cross-page', kind: 'playMotion', targetNodeId: otherTarget.id, trackId: 'enter' }
        ]
      }
    })

    const ir = collectTree(graph, pageId)
    expect(ir.warnings).toContainEqual({
      code: 'action-play-motion-target-outside-page',
      message: expect.stringContaining('is not rendered on the current output page'),
      nodeId: expect.any(String)
    })
  })

  test('treats an instance-local source descendant as reachable across authoring pages', () => {
    const graph = makeSceneGraph()
    const sourcePageId = firstPageId(graph)
    const usePage = graph.addPage('Use')
    const master = graph.createNode('COMPONENT', sourcePageId, { name: 'Motion Source' })
    const child = graph.createNode('RECTANGLE', master.id, { motion: MOTION })
    graph.updateNode(master.id, {
      events: {
        onClick: [{ id: 'local-child', kind: 'playMotion', targetNodeId: child.id }]
      }
    })
    const instance = graph.createInstance(master.id, usePage.id)
    if (!instance) throw new Error('Expected clean component instance')

    const out = compile({
      graph,
      pageIds: [usePage.id],
      options: withDefaults({ packageName: 'instance-local-motion-target', devMode: false })
    })
    expect(out.warnings.map((warning) => warning.code)).not.toContain(
      'action-play-motion-target-outside-page'
    )
    expect(out.files.get('src/App.tsx')).toContain(
      `window.__OPENPENCIL_MOTION_RUNTIME__?.play("${child.id}", undefined, __opMotionScope)`
    )
  })

  test('marks component bodies whose descendant events control an instance sibling', () => {
    const graph = makeSceneGraph()
    const sourcePageId = firstPageId(graph)
    const usePage = graph.addPage('Use')
    const master = graph.createNode('COMPONENT', sourcePageId, { name: 'Scoped Card' })
    const trigger = graph.createNode('BUTTON', master.id, { interactiveProps: { text: 'Play' } })
    const sibling = graph.createNode('RECTANGLE', master.id, { motion: MOTION })
    graph.updateNode(trigger.id, {
      events: {
        onClick: [{ id: 'sibling', kind: 'playMotion', targetNodeId: sibling.id }]
      }
    })
    if (!graph.createInstance(master.id, usePage.id)) throw new Error('Expected first instance')
    if (!graph.createInstance(master.id, usePage.id)) throw new Error('Expected second instance')

    const out = compile({
      graph,
      pageIds: [usePage.id],
      options: withDefaults({ packageName: 'component-descendant-motion-scope', devMode: false })
    })
    const app = out.files.get('src/App.tsx') as string
    const component = out.files.get('src/components/ScopedCard.tsx') as string
    expect(app.match(/<ScopedCard/g)).toHaveLength(2)
    expect(component).toContain('<div data-op-motion-scope')
    expect(component).toContain('const __opMotionScope = e.currentTarget;')
    expect(component).toContain(
      `window.__OPENPENCIL_MOTION_RUNTIME__?.play("${sibling.id}", undefined, __opMotionScope)`
    )
  })

  test('preserves component and clean-instance root motion actions', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const target = graph.createNode('RECTANGLE', pageId, { motion: MOTION })
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Motion Action',
      events: {
        onClick: [{ id: 'play', kind: 'playMotion', targetNodeId: target.id, trackId: 'enter' }]
      }
    })
    graph.createNode('TEXT', master.id, { text: 'Play' })
    const instance = graph.createInstance(master.id, pageId)
    if (!instance) throw new Error('Expected clean component instance')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'component-root-motion-action', devMode: false })
    })
    const app = out.files.get('src/App.tsx') as string
    const component = out.files.get('src/components/MotionAction.tsx') as string
    expect(app.match(/__opRootEvents=/g)).toHaveLength(2)
    expect(app).toContain(
      `window.__OPENPENCIL_MOTION_RUNTIME__?.play("${target.id}", "enter", __opMotionScope)`
    )
    expect(component).toContain('{...__opRootEvents}')
    expect(component).toContain('data-op-motion-scope')
    expect(component).toContain("Pick<HTMLAttributes<HTMLDivElement>, 'onClick'")
    expect(out.files.has('src/__motion-runtime.ts')).toBe(true)
  })

  test('scopes inherited component motion actions to the rendered instance', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const external = graph.createNode('RECTANGLE', pageId, { motion: MOTION })
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Scoped Motion Action',
      motion: MOTION
    })
    const child = graph.createNode('RECTANGLE', master.id, { motion: MOTION })
    graph.updateNode(master.id, {
      events: {
        onClick: [
          { id: 'self', kind: 'playMotion', targetNodeId: master.id },
          { id: 'child', kind: 'playMotion', targetNodeId: child.id },
          { id: 'external', kind: 'stopMotion', targetNodeId: external.id }
        ]
      }
    })
    const instance = graph.createInstance(master.id, pageId)
    if (!instance) throw new Error('Expected clean component instance')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'component-scoped-motion-action', devMode: false })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(
      `window.__OPENPENCIL_MOTION_RUNTIME__?.play("${master.id}", undefined, __opMotionScope)`
    )
    expect(app).toContain(
      `window.__OPENPENCIL_MOTION_RUNTIME__?.play("${instance.id}", undefined, __opMotionScope)`
    )
    expect(
      app.match(new RegExp(`play\\("${child.id}", undefined, __opMotionScope\\)`, 'g'))
    ).toHaveLength(2)
    expect(
      app.match(new RegExp(`stop\\("${external.id}", undefined, __opMotionScope\\)`, 'g'))
    ).toHaveLength(2)
    expect(out.warnings).toEqual([])
  })

  test('discovers programmatic motion actions inside nested branches', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const target = graph.createNode('RECTANGLE', pageId, { motion: MOTION })
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [
          {
            id: 'condition',
            kind: 'condition',
            condExpr: '1 === 1',
            consequent: [
              { id: 'play', kind: 'playMotion', targetNodeId: target.id, trackId: 'enter' }
            ]
          }
        ]
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'nested-motion-action', devMode: false })
    })
    expect(out.files.get('src/App.tsx')).toContain(
      `if (1 === 1) { window.__OPENPENCIL_MOTION_RUNTIME__?.play("${target.id}", "enter", __opMotionScope); }`
    )
    expect(out.files.has('src/__motion-runtime.ts')).toBe(true)
  })

  test('forces a runtime for CSS-only target motion and keeps production node identity', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const target = graph.createNode('RECTANGLE', pageId, { width: 80, height: 40, motion: MOTION })
    graph.createNode('BUTTON', pageId, {
      interactiveProps: { text: 'Replay' },
      events: {
        onClick: [
          {
            id: 'play',
            kind: 'playMotion',
            targetNodeId: target.id,
            trackId: 'enter'
          },
          { id: 'stop', kind: 'stopMotion', targetNodeId: target.id }
        ]
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-actions', devMode: false })
    })
    const app = out.files.get('src/App.tsx') as string
    const css = out.files.get('src/__motion.css') as string
    const runtime = out.files.get('src/__motion-runtime.ts') as string
    const main = out.files.get('src/main.tsx') as string

    expect(app).toContain(`data-node-id="${target.id}"`)
    expect(app).toContain(
      `window.__OPENPENCIL_MOTION_RUNTIME__?.play("${target.id}", "enter", __opMotionScope)`
    )
    expect(app).toContain(
      `window.__OPENPENCIL_MOTION_RUNTIME__?.stop("${target.id}", undefined, __opMotionScope)`
    )
    expect(css).toMatch(/animation-name: var\(--op-[^,]+, op-[^)]+\)/)
    expect(runtime).toContain('id: string')
    expect(runtime).toContain('const runtimeHandle: OpenPencilMotionRuntimeHandle = {')
    expect(runtime).toContain('  pageExit,')
    expect(runtime).toContain('  toggle,')
    expect(runtime).toContain('  wait\n}')
    expect(runtime).toContain('id":"enter"')
    expect(main).toContain("import './__motion-runtime'")
  })
})
