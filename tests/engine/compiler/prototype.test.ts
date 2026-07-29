import { describe, expect, test } from 'bun:test'

import { buildComponentRegistry } from '#compiler/ir/collect/components'
import { collectComponents } from '#compiler/ir/collect/tree'
import type { IRElement } from '#compiler/ir/types'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { PrototypeConnection, SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function compilePrototype(graph: SceneGraph, pageIds = graph.getPages().map((page) => page.id)) {
  return compile({
    graph,
    pageIds,
    options: withDefaults({ packageName: 'prototype-test', devMode: false })
  })
}

function connection(
  id: string,
  action: PrototypeConnection['action'],
  overrides: Partial<PrototypeConnection> = {}
): PrototypeConnection {
  return {
    id,
    trigger: { kind: 'click' },
    action,
    transition: { kind: 'dissolve', durationMs: 240, easing: 'ease-out' },
    interruption: 'replace',
    playback: 'forward',
    ...overrides
  }
}

describe('compiler — prototype IR and React runtime', () => {
  test('resolves a frame destination to its compiled route and emits explicit Smart Match markers', () => {
    const graph = makeSceneGraph()
    const home = graph.getNode(firstPageId(graph))
    if (!home) throw new Error('missing home page')
    graph.updateNode(home.id, { name: 'Home' })
    const details = graph.addPage('Details')
    const destination = graph.createNode('FRAME', details.id, {
      name: 'Details frame',
      transitionKey: 'hero-card'
    })
    const source = graph.createNode('BUTTON', home.id, {
      name: 'Open details',
      transitionKey: 'hero-card',
      prototype: {
        version: 1,
        connections: [
          connection(
            'open-details',
            { kind: 'navigate', targetNodeId: destination.id },
            {
              transition: {
                kind: 'smartMatch',
                durationMs: 360,
                easing: 'ease-in-out',
                fallback: 'dissolve'
              }
            }
          )
        ]
      }
    })

    const out = compilePrototype(graph, [home.id, details.id])
    const shell = out.files.get('src/App.tsx') as string
    const homeModule = out.files.get('src/pages/index.tsx') as string
    const detailsModule = out.files.get('src/pages/details.tsx') as string
    const runtime = out.files.get('src/__prototype-runtime.ts') as string

    expect(out.warnings).toEqual([])
    expect(shell).toContain("import './__prototype-runtime'")
    expect(homeModule).toContain(`data-op-prototype-node="${source.id}"`)
    expect(homeModule).toContain('data-op-prototype-source')
    expect(homeModule).not.toContain('data-op-prototype-keyboard')
    expect(homeModule).toContain('data-op-transition-key="hero-card"')
    expect(detailsModule).toContain(`data-op-prototype-node="${destination.id}"`)
    expect(runtime).toContain(`"route":"/details"`)
    expect(runtime).toContain(`"targetNodeId":"${destination.id}"`)
    expect(runtime).toContain('view-transition-name')
    expect(runtime).toContain("return 'opm-' + fnv1a(scopeToken + ':' + key)")
    expect(runtime).toContain("runtimeWindow.matchMedia('(prefers-reduced-motion: reduce)')")
    expect(runtime).toContain(
      "reducedMotionQuery?.addEventListener('change', finishActiveTransitionForReducedMotion)"
    )
    expect(runtime).toContain('animation.finish()')
    expect(runtime).toContain('animation.cancel()')
    expect(runtime).toContain('animation.effect = null')
    expect(runtime).toContain('run.reducedMotionTerminated = true')
    expect(runtime).toContain('clearRunTransitionNames(run)')
    expect(runtime).toContain(
      "reducedMotionQuery?.removeEventListener('change', finishActiveTransitionForReducedMotion)"
    )
  })

  test('adds delegated keyboard semantics only to non-native click sources', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const target = graph.createNode('FRAME', pageId, { name: 'Target' })
    const source = graph.createNode('RECTANGLE', pageId, {
      name: 'Keyboard source',
      prototype: {
        version: 1,
        connections: [connection('keyboard-go', { kind: 'navigate', targetNodeId: target.id })]
      }
    })
    graph.createNode('TEXT', source.id, { text: 'Open target' })

    const out = compilePrototype(graph, [pageId])
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__prototype-runtime.ts') as string
    expect(app).toContain(`data-op-prototype-node="${source.id}"`)
    expect(app).toContain('data-op-prototype-keyboard role="button" tabIndex={0}')
    expect(runtime).toContain('function onKeyDown(event: KeyboardEvent)')
    expect(runtime).toContain("if (event.key === ' ') event.preventDefault()")
    expect(runtime).toContain("runtimeDocument.addEventListener('keydown', onKeyDown)")
    expect(runtime).toContain("runtimeDocument?.removeEventListener('keydown', onKeyDown)")
  })

  test('drops prototype click when lowcode onClick exists but retains afterDelay', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const destination = graph.createNode('FRAME', pageId, { name: 'Destination' })
    const source = graph.createNode('BUTTON', pageId, {
      name: 'Conflicted source',
      events: { onClick: [{ id: 'lowcode', kind: 'navigate', to: '/legacy' }] },
      prototype: {
        version: 1,
        connections: [
          connection('prototype-click', { kind: 'navigate', targetNodeId: destination.id }),
          connection(
            'prototype-delay',
            { kind: 'navigate', targetNodeId: destination.id },
            {
              trigger: { kind: 'afterDelay', delayMs: 25 },
              transition: { kind: 'instant' }
            }
          )
        ]
      }
    })

    const out = compilePrototype(graph, [pageId])
    const runtime = out.files.get('src/__prototype-runtime.ts') as string
    expect(out.warnings).toContainEqual(
      expect.objectContaining({ code: 'prototype-click-lowcode-conflict', nodeId: source.id })
    )
    expect(runtime).not.toContain('prototype-click')
    expect(runtime).toContain('prototype-delay')
    expect(runtime).toContain('afterDelay')
  })

  test('overlay target emits hidden runtime marker and generated runtime owns a11y cleanup', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const opener = graph.createNode('BUTTON', pageId, { name: 'Open overlay' })
    const overlay = graph.createNode('FRAME', pageId, {
      name: 'Dialog',
      transitionKey: 'dialog-shell'
    })
    graph.createNode('BUTTON', overlay.id, { name: 'Close' })
    graph.updateNode(opener.id, {
      prototype: {
        version: 1,
        connections: [
          connection('open-dialog', {
            kind: 'openOverlay',
            targetNodeId: overlay.id,
            placement: 'center',
            dismissOnOutside: true
          })
        ]
      }
    })

    const out = compilePrototype(graph, [pageId])
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__prototype-runtime.ts') as string
    expect(app).toContain(`data-op-prototype-node="${overlay.id}"`)
    expect(app).toContain('data-op-prototype-overlay-target hidden')
    expect(runtime).toContain("target.setAttribute('role', 'dialog')")
    expect(runtime).toContain("target.setAttribute('aria-modal', 'true')")
    expect(runtime).toContain("page.setAttribute('inert', '')")
    expect(runtime).toContain("if (event.key === 'Escape')")
    expect(runtime).toContain('previousFocus.focus()')
    expect(runtime).toContain('closeAllOverlays()')
  })

  test('scopes overlay afterDelay timers to each active open lifecycle', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const opener = graph.createNode('BUTTON', pageId, { name: 'Open delayed overlay' })
    const overlay = graph.createNode('FRAME', pageId, { name: 'Delayed overlay' })
    const delaySource = graph.createNode('FRAME', overlay.id, {
      name: 'Delayed close',
      prototype: {
        version: 1,
        connections: [
          connection(
            'auto-close-overlay',
            { kind: 'closeOverlay' },
            {
              trigger: { kind: 'afterDelay', delayMs: 250 },
              transition: { kind: 'instant' }
            }
          )
        ]
      }
    })
    graph.updateNode(opener.id, {
      prototype: {
        version: 1,
        connections: [
          connection('open-delayed-overlay', {
            kind: 'openOverlay',
            targetNodeId: overlay.id,
            placement: 'center'
          })
        ]
      }
    })

    const out = compilePrototype(graph, [pageId])
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__prototype-runtime.ts') as string

    expect(app).toContain(`data-op-prototype-node="${overlay.id}"`)
    expect(app).toContain(`data-op-prototype-node="${delaySource.id}"`)
    expect(runtime).toContain('"id":"auto-close-overlay"')
    expect(runtime).toContain(
      "if (source.closest('[data-op-prototype-overlay-target][hidden]')) return false"
    )
    expect(runtime).toContain(
      "if (source.closest('[data-op-prototype-overlay-target]')) return false"
    )
    expect(runtime).toContain('if (!element.isConnected || !isActiveSource(element))')
    expect(runtime).toContain('deactivateDelaySources(record.target)')
    expect(runtime).toContain('scanDelaySources(record.target)')
    expect(runtime).toContain('if (previousPage) deactivateDelaySources(previousPage)')
    expect(runtime).toContain('scanDelaySources(page)')
    expect(runtime).toContain('delayStates.delete(element)')
    expect(runtime).toContain('delayTimerCount: delayRecords.size')
  })

  test('uncompiled and cross-page overlay targets fail closed with explicit warnings', () => {
    const graph = makeSceneGraph()
    const homeId = firstPageId(graph)
    const other = graph.addPage('Other')
    const frame = graph.createNode('FRAME', other.id, { name: 'Remote frame' })
    graph.createNode('BUTTON', homeId, {
      prototype: {
        version: 1,
        connections: [
          connection('not-compiled', { kind: 'navigate', targetNodeId: frame.id }),
          connection('cross-page-overlay', {
            kind: 'openOverlay',
            targetNodeId: frame.id,
            placement: 'right'
          })
        ]
      }
    })

    const out = compilePrototype(graph, [homeId])
    expect(out.warnings.map((warning) => warning.code)).toContain('prototype-target-not-compiled')
    expect(out.warnings.map((warning) => warning.code)).toContain('prototype-overlay-cross-page')
    expect(out.files.has('src/__prototype-runtime.ts')).toBe(false)
  })

  test('component instance roots forward prototype markers to the generated boundary', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const library = graph.addPage('Components')
    const master = graph.createNode('COMPONENT', library.id, { name: 'Prototype Card' })
    graph.createNode('TEXT', master.id, { text: 'Card' })
    const instance = graph.createInstance(master.id, pageId)
    if (!instance) throw new Error('missing instance')
    const target = graph.createNode('FRAME', pageId, { name: 'Target' })
    graph.updateNode(instance.id, {
      transitionKey: 'component-card',
      prototype: {
        version: 1,
        connections: [connection('component-go', { kind: 'navigate', targetNodeId: target.id })]
      }
    })

    const out = compilePrototype(graph, [pageId])
    const app = out.files.get('src/App.tsx') as string
    const component = out.files.get('src/components/PrototypeCard.tsx') as string
    expect(app).toContain(`__opPrototypeNode="${instance.id}"`)
    expect(app).toContain('__opPrototypeSource')
    expect(app).toContain('__opPrototypeKeyboard')
    expect(app).toContain('__opTransitionKey="component-card"')
    expect(component).toContain('data-op-prototype-node={__opPrototypeNode}')
    expect(component).toContain('data-op-prototype-source={__opPrototypeSource')
    expect(component).toContain('data-op-prototype-keyboard={__opPrototypeKeyboard')
    expect(component).toContain("role={__opPrototypeKeyboard ? 'button' : undefined}")
    expect(component).toContain('tabIndex={__opPrototypeKeyboard ? 0 : undefined}')
  })

  test('component-body prototype ids, targets, delays, and Smart Match keys are scoped per instance', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const library = graph.addPage('Components')
    const master = graph.createNode('COMPONENT', library.id, {
      name: 'Scoped Prototype Card',
      width: 240,
      height: 180
    })
    const source = graph.createNode('RECTANGLE', master.id, {
      name: 'Open card dialog',
      width: 120,
      height: 44,
      transitionKey: 'card-hero'
    })
    graph.createNode('TEXT', source.id, { text: 'Open card dialog' })
    const target = graph.createNode('FRAME', master.id, {
      name: 'Card dialog',
      width: 180,
      height: 120,
      transitionKey: 'card-hero'
    })
    const delayedClose = graph.createNode('FRAME', target.id, {
      name: 'Delayed close'
    })
    graph.createNode('TEXT', delayedClose.id, { text: 'Closing soon' })
    graph.updateNode(source.id, {
      prototype: {
        version: 1,
        connections: [
          connection(
            'open-card-dialog',
            {
              kind: 'openOverlay',
              targetNodeId: target.id,
              placement: 'center'
            },
            {
              transition: {
                kind: 'smartMatch',
                durationMs: 160,
                easing: 'ease-in-out',
                fallback: 'dissolve'
              }
            }
          )
        ]
      }
    })
    graph.updateNode(delayedClose.id, {
      prototype: {
        version: 1,
        connections: [
          connection(
            'close-card-dialog',
            { kind: 'closeOverlay' },
            {
              trigger: { kind: 'afterDelay', delayMs: 250 }
            }
          )
        ]
      }
    })
    const first = graph.createInstance(master.id, pageId)
    const second = graph.createInstance(master.id, pageId)
    if (!first || !second) throw new Error('missing component instances')

    const componentIR = collectComponents(graph, buildComponentRegistry(graph)).defs.find(
      (def) => def.componentId === master.id
    )
    if (!componentIR) throw new Error('missing component IR')
    const sourceIR = componentIR.children.find(
      (child): child is IRElement => child.kind === 'element' && child.sourceId === source.id
    )
    const targetIR = componentIR.children.find(
      (child): child is IRElement => child.kind === 'element' && child.sourceId === target.id
    )
    expect(componentIR.prototypeBody).toBeTrue()
    expect(sourceIR).toMatchObject({
      prototypeScope: true,
      transitionKey: 'card-hero',
      prototype: {
        connections: [
          {
            action: {
              kind: 'openOverlay',
              target: { componentPath: [target.id], kind: 'frame', nodeId: target.id }
            }
          }
        ]
      }
    })
    expect(targetIR).toMatchObject({
      prototypeScope: true,
      prototypeOverlayTarget: true,
      prototypeTarget: true,
      transitionKey: 'card-hero'
    })

    const out = compilePrototype(graph, [pageId])
    const app = out.files.get('src/App.tsx') as string
    const component = out.files.get('src/components/ScopedPrototypeCard.tsx') as string
    const runtime = out.files.get('src/__prototype-runtime.ts') as string
    const scoped = (scope: string, value: string) => JSON.stringify([scope, value])
    const firstSource = scoped(first.id, source.id)
    const secondSource = scoped(second.id, source.id)
    const firstTarget = scoped(first.id, target.id)
    const secondTarget = scoped(second.id, target.id)

    expect(out.warnings).toEqual([])
    expect(app).toContain(`__opPrototypeScope="${first.id}"`)
    expect(app).toContain(`__opPrototypeScope="${second.id}"`)
    expect(component).toContain('__opPrototypeScope: string')
    expect(component).toContain(
      `data-op-prototype-node={JSON.stringify([__opPrototypeScope, "${source.id}"])}`
    )
    expect(component).toContain('data-op-prototype-keyboard role="button" tabIndex={0}')
    expect(component).toContain(
      `data-op-prototype-node={JSON.stringify([__opPrototypeScope, "${target.id}"])}`
    )
    expect(component).toContain('data-op-prototype-overlay-target hidden')
    expect(component).toContain(
      `data-op-transition-key={JSON.stringify([__opPrototypeScope, "card-hero"])}`
    )
    expect(runtime).toContain(JSON.stringify(firstSource).slice(1, -1))
    expect(runtime).toContain(JSON.stringify(secondSource).slice(1, -1))
    expect(runtime).toContain(JSON.stringify(firstTarget).slice(1, -1))
    expect(runtime).toContain(JSON.stringify(secondTarget).slice(1, -1))
    expect(runtime).toContain('close-card-dialog')
    expect(firstSource).not.toBe(secondSource)
    expect(firstTarget).not.toBe(secondTarget)
  })

  test('keeps component-body navigation to a compiled page and rejects only cross-boundary overlays', () => {
    const graph = makeSceneGraph()
    const homeId = firstPageId(graph)
    const details = graph.addPage('Details')
    const detailsFrame = graph.createNode('FRAME', details.id, { name: 'Details destination' })
    const outsideOverlay = graph.createNode('FRAME', homeId, { name: 'Outside dialog' })
    const library = graph.addPage('Components')
    const master = graph.createNode('COMPONENT', library.id, { name: 'Navigation Card' })
    const source = graph.createNode('RECTANGLE', master.id, {
      name: 'Navigate from component',
      prototype: {
        version: 1,
        connections: [
          connection('component-page-nav', {
            kind: 'navigate',
            targetNodeId: detailsFrame.id
          }),
          connection('component-cross-overlay', {
            kind: 'openOverlay',
            targetNodeId: outsideOverlay.id,
            placement: 'center'
          })
        ]
      }
    })
    const instance = graph.createInstance(master.id, homeId)
    if (!instance) throw new Error('missing navigation component instance')

    const out = compilePrototype(graph, [homeId, details.id])
    const homeModule = out.files.get('src/pages/index.tsx') as string
    const component = out.files.get('src/components/NavigationCard.tsx') as string
    const runtime = out.files.get('src/__prototype-runtime.ts') as string
    const sourceRuntimeId = JSON.stringify([instance.id, source.id])

    expect(out.warnings).toContainEqual(
      expect.objectContaining({
        code: 'prototype-component-overlay-cross-boundary',
        nodeId: source.id
      })
    )
    expect(out.warnings.map((warning) => warning.code)).not.toContain(
      'prototype-component-target-scope-unresolved'
    )
    expect(homeModule).toContain(`__opPrototypeScope="${instance.id}"`)
    expect(component).toContain(
      `data-op-prototype-node={JSON.stringify([__opPrototypeScope, "${source.id}"])}`
    )
    expect(runtime).toContain(JSON.stringify(sourceRuntimeId).slice(1, -1))
    expect(runtime).toContain('component-page-nav')
    expect(runtime).toContain(`"route":"/details"`)
    expect(runtime).toContain(`"targetNodeId":"${detailsFrame.id}"`)
    expect(runtime).not.toContain('component-cross-overlay')
  })

  test('page prototype sources resolve targets inside clean component instances', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const library = graph.addPage('Components')
    const master = graph.createNode('COMPONENT', library.id, { name: 'Target Card' })
    const masterTarget = graph.createNode('FRAME', master.id, {
      name: 'Instance dialog',
      transitionKey: 'instance-dialog'
    })
    graph.createNode('TEXT', masterTarget.id, { text: 'Instance dialog content' })
    const instance = graph.createInstance(master.id, pageId)
    if (!instance) throw new Error('missing target component instance')
    const clonedTarget = graph
      .getChildren(instance.id)
      .find((child) => child.componentId === masterTarget.id)
    if (!clonedTarget) throw new Error('missing cloned target frame')
    const opener = graph.createNode('BUTTON', pageId, {
      name: 'Open instance dialog',
      prototype: {
        version: 1,
        connections: [
          connection('open-instance-dialog', {
            kind: 'openOverlay',
            targetNodeId: clonedTarget.id,
            placement: 'center'
          })
        ]
      }
    })

    const out = compilePrototype(graph, [pageId])
    const app = out.files.get('src/App.tsx') as string
    const component = out.files.get('src/components/TargetCard.tsx') as string
    const runtime = out.files.get('src/__prototype-runtime.ts') as string
    const targetRuntimeId = JSON.stringify([instance.id, masterTarget.id])

    expect(out.warnings).toEqual([])
    expect(app).toContain(`data-op-prototype-node="${opener.id}"`)
    expect(app).toContain(`__opPrototypeScope="${instance.id}"`)
    expect(component).toContain(
      `data-op-prototype-node={JSON.stringify([__opPrototypeScope, "${masterTarget.id}"])}`
    )
    expect(component).toContain('data-op-prototype-overlay-target hidden')
    expect(runtime).toContain(`"targetNodeId":${JSON.stringify(targetRuntimeId)}`)
  })
})
