/* oxlint-disable open-pencil/no-broad-double-cast -- Minimal EventTarget fakes model browser structural types without a DOM implementation. */
import { describe, expect, test } from 'bun:test'

import type { MotionDriverSpecV1, MotionSpec } from '@open-pencil/scene-graph'

import {
  createDOMMotionDrivers,
  type MotionDriverDOMElement,
  type MotionDriverViewport,
  type MotionDriverVisibilityEntry
} from '../src/drivers'

class FakeStyle {
  readonly values = new Map<string, { value: string; priority: string }>()

  getPropertyValue(property: string): string {
    return this.values.get(property)?.value ?? ''
  }

  getPropertyPriority(property: string): string {
    return this.values.get(property)?.priority ?? ''
  }

  setProperty(property: string, value: string, priority = ''): void {
    this.values.set(property, { value, priority })
  }

  removeProperty(property: string): string {
    const current = this.getPropertyValue(property)
    this.values.delete(property)
    return current
  }
}

class FakeElement extends EventTarget {
  readonly style = new FakeStyle()
  readonly attrs = new Map<string, string>()
  clientWidth = 100
  clientHeight = 100
  scrollWidth = 100
  scrollHeight = 500
  scrollLeft = 0
  scrollTop = 0
  rect = { left: 10, top: 20, width: 100, height: 100 }
  parent: FakeElement | undefined
  readonly children: FakeElement[] = []

  append(child: FakeElement): FakeElement {
    child.parent = this
    this.children.push(child)
    return child
  }

  matches(selector: string): boolean {
    if (selector === '[data-op-motion-scope]') return this.attrs.has('data-op-motion-scope')
    const match = /^\[data-node-id="(.*)"\]$/.exec(selector)
    return match ? this.getAttribute('data-node-id') === match[1] : false
  }

  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this
    let candidate = this.parent
    while (candidate) {
      if (candidate.matches(selector)) return candidate
      candidate = candidate.parent
    }
    return null
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child
      const nested = child.querySelector(selector)
      if (nested) return nested
    }
    return null
  }

  getBoundingClientRect() {
    return this.rect
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name)
  }
}

class FakeViewport extends EventTarget {
  innerWidth = 800
  innerHeight = 600
  scrollX = 0
  scrollY = 0
  document = { documentElement: { scrollWidth: 800, scrollHeight: 1_200 } }
}

function element(value: FakeElement): MotionDriverDOMElement {
  return value as unknown as MotionDriverDOMElement
}

function viewport(value: FakeViewport): MotionDriverViewport {
  return value as unknown as MotionDriverViewport
}

function motion(trackId: string, reducedMotion: MotionSpec['reducedMotion'] = 'allow'): MotionSpec {
  return {
    version: 1,
    reducedMotion,
    tracks: [
      {
        id: trackId,
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0 },
          { offset: 1, x: 100 }
        ],
        timing: { durationMs: 1_000, easing: 'linear', fill: 'both' }
      }
    ]
  }
}

function driver(
  id: string,
  source: MotionDriverSpecV1['drivers'][number]['source'],
  targetNodeId = `target-${id}`
): MotionDriverSpecV1['drivers'][number] {
  return {
    id,
    source,
    target: { targetNodeId, trackId: `track-${id}` },
    mapping: { inputMin: 0, inputMax: 1 }
  }
}

function pointer(type: string, values: Record<string, number>): Event {
  const event = new Event(type)
  Object.assign(event, values)
  return event
}

describe('DOM continuous Motion drivers', () => {
  test('coalesces scroll input, suppresses automatic tracks, and restores on cleanup', () => {
    const owner = new FakeElement()
    const source = new FakeElement()
    const target = new FakeElement()
    target.style.setProperty('transform', 'rotate(3deg)')
    const elements = new Map([
      ['source', source],
      ['target-scroll', target]
    ])
    const spec: MotionDriverSpecV1 = {
      version: 1,
      drivers: [
        driver('scroll', { kind: 'scroll', sourceNodeId: 'source', axis: 'y', metric: 'progress' })
      ]
    }
    const batches: number[] = []
    const controller = createDOMMotionDrivers({
      id: 'page',
      owner: element(owner),
      root: {} as ParentNode,
      viewport: viewport(new FakeViewport()),
      spec,
      resolveElement: (id) => element(elements.get(id) as FakeElement),
      resolveMotion: (id) => (id === 'target-scroll' ? motion('track-scroll') : undefined),
      onBatch: (batch) => batches.push(batch.outputs.length)
    })

    expect(target.getAttribute('data-op-motion-driver-tracks')).toBe('track-scroll')
    source.scrollTop = 100
    source.dispatchEvent(new Event('scroll'))
    source.scrollTop = 200
    source.dispatchEvent(new Event('scroll'))
    controller.flush()
    expect(batches).toEqual([1])
    expect(target.style.getPropertyValue('transform')).toContain('translate3d(50px')

    controller.dispose()
    expect(target.style.getPropertyValue('transform')).toBe('rotate(3deg)')
    expect(target.getAttribute('data-op-motion-driver-tracks')).toBeNull()
    source.scrollTop = 300
    source.dispatchEvent(new Event('scroll'))
    expect(target.style.getPropertyValue('transform')).toBe('rotate(3deg)')
  })

  test('maps local pointer, drag, visibility, and explicit safe host state setters', () => {
    const owner = new FakeElement()
    const pointerSource = new FakeElement()
    const dragHandle = new FakeElement()
    const visibleSource = new FakeElement()
    const view = new FakeViewport()
    const drivers = [
      driver('pointer', {
        kind: 'pointer',
        sourceNodeId: 'pointer-source',
        axis: 'x',
        space: 'local'
      }),
      driver('drag', { kind: 'drag', handleNodeId: 'drag-handle', axis: 'x', distance: 100 }),
      driver('visibility', { kind: 'visibility', sourceNodeId: 'visible-source' }),
      driver('page', { kind: 'pageState', stateId: 'page-progress' }),
      driver('document', { kind: 'documentState', stateId: 'document-progress' }),
      driver('variable', { kind: 'variable', variableId: 'variable-progress' })
    ] satisfies MotionDriverSpecV1['drivers']
    const targetElements = new Map<string, FakeElement>()
    const sources = new Map([
      ['pointer-source', pointerSource],
      ['drag-handle', dragHandle],
      ['visible-source', visibleSource]
    ])
    for (const candidate of drivers)
      targetElements.set(candidate.target.targetNodeId, new FakeElement())
    let visibilityCallback: ((entries: readonly MotionDriverVisibilityEntry[]) => void) | undefined
    let disconnectCount = 0
    const controller = createDOMMotionDrivers({
      id: 'mixed-sources',
      owner: element(owner),
      root: {} as ParentNode,
      viewport: viewport(view),
      spec: { version: 1, drivers },
      resolveElement: (id) => element((sources.get(id) ?? targetElements.get(id)) as FakeElement),
      resolveMotion: (id) => {
        const candidate = drivers.find((entry) => entry.target.targetNodeId === id)
        return candidate ? motion(candidate.target.trackId) : undefined
      },
      createVisibilityObserver: (callback) => {
        visibilityCallback = callback
        return {
          observe: () => undefined,
          unobserve: () => undefined,
          disconnect: () => disconnectCount++
        }
      }
    })

    pointerSource.dispatchEvent(pointer('pointermove', { clientX: 60, clientY: 20 }))
    controller.flush()
    expect(targetElements.get('target-pointer')?.style.getPropertyValue('transform')).toContain(
      'translate3d(100px'
    )

    dragHandle.dispatchEvent(pointer('pointerdown', { pointerId: 7, clientX: 20, clientY: 0 }))
    view.dispatchEvent(pointer('pointermove', { pointerId: 7, clientX: 70, clientY: 0 }))
    controller.flush()
    expect(targetElements.get('target-drag')?.style.getPropertyValue('transform')).toContain(
      'translate3d(50px'
    )

    visibilityCallback?.([
      { target: element(visibleSource), isIntersecting: true, intersectionRatio: 0.4 }
    ])
    expect(controller.setPageState('page-progress', 0.2)).toBe(1)
    expect(controller.setDocumentState('document-progress', true)).toBe(1)
    expect(controller.setVariable('variable-progress', 0.7)).toBe(1)
    expect(controller.setVariable('unknown', 0.5)).toBe(0)
    controller.flush()
    expect(targetElements.get('target-visibility')?.style.getPropertyValue('transform')).toContain(
      'translate3d(40px'
    )
    expect(targetElements.get('target-page')?.style.getPropertyValue('transform')).toContain(
      'translate3d(20px'
    )
    expect(targetElements.get('target-document')?.style.getPropertyValue('transform')).toContain(
      'translate3d(100px'
    )
    expect(targetElements.get('target-variable')?.style.getPropertyValue('transform')).toContain(
      'translate3d(70px'
    )
    expect(() => controller.setVariable('x'.repeat(257), 0)).toThrow('bounded string')
    expect(() => controller.setVariable('variable-progress', Number.POSITIVE_INFINITY)).toThrow(
      'finite'
    )

    controller.dispose()
    expect(disconnectCount).toBe(1)
    expect(() => controller.setPageState('page-progress', 0)).toThrow('disposed')
  })

  test('honors disable reduced-motion policy without binding source listeners', () => {
    const owner = new FakeElement()
    const source = new FakeElement()
    const target = new FakeElement()
    let batchCount = 0
    const controller = createDOMMotionDrivers({
      id: 'reduced',
      owner: element(owner),
      root: {} as ParentNode,
      viewport: viewport(new FakeViewport()),
      prefersReducedMotion: true,
      spec: {
        version: 1,
        drivers: [
          driver('scroll', {
            kind: 'scroll',
            sourceNodeId: 'source',
            axis: 'y',
            metric: 'progress'
          })
        ]
      },
      resolveElement: (id) => element(id === 'source' ? source : target),
      resolveMotion: (id) =>
        id === 'target-scroll' ? motion('track-scroll', 'disable') : undefined,
      onBatch: () => batchCount++
    })
    expect(controller.driverIds).toEqual([])
    expect(controller.issues[0]?.code).toBe('track-disabled')
    source.dispatchEvent(new Event('scroll'))
    controller.flush()
    expect(batchCount).toBe(0)
    controller.dispose()
  })

  test('bounds public scope ids before registering browser resources', () => {
    const owner = new FakeElement()
    expect(() =>
      createDOMMotionDrivers({
        id: 'x'.repeat(129),
        owner: element(owner),
        root: {} as ParentNode,
        viewport: viewport(new FakeViewport()),
        spec: {
          version: 1,
          drivers: [driver('page', { kind: 'pageState', stateId: 'progress' })]
        },
        resolveElement: () => element(new FakeElement()),
        resolveMotion: () => motion('track-page')
      })
    ).toThrow('scope id')
  })

  test('keeps default node lookup inside its owner scope when ids repeat', () => {
    const root = new FakeElement()
    const scopeA = root.append(new FakeElement())
    scopeA.setAttribute('data-op-motion-scope', '')
    const ownerA = scopeA.append(new FakeElement())
    const sourceA = scopeA.append(new FakeElement())
    sourceA.setAttribute('data-node-id', 'shared-source')

    const scopeB = root.append(new FakeElement())
    scopeB.setAttribute('data-op-motion-scope', '')
    const sourceB = scopeB.append(new FakeElement())
    sourceB.setAttribute('data-node-id', 'shared-source')
    const targetB = scopeB.append(new FakeElement())
    targetB.setAttribute('data-node-id', 'shared-target')

    const spec: MotionDriverSpecV1 = {
      version: 1,
      drivers: [
        driver(
          'scoped',
          { kind: 'scroll', sourceNodeId: 'shared-source', axis: 'y', metric: 'progress' },
          'shared-target'
        )
      ]
    }
    const options = {
      id: 'scope-a',
      owner: element(ownerA),
      root: root as unknown as ParentNode,
      viewport: viewport(new FakeViewport()),
      spec,
      resolveMotion: (id: string) => (id === 'shared-target' ? motion('track-scoped') : undefined)
    }
    const scoped = createDOMMotionDrivers(options)

    expect(scoped.driverIds).toEqual([])
    expect(scoped.issues).toHaveLength(1)
    expect(targetB.getAttribute('data-op-motion-driver-tracks')).toBeNull()
    sourceA.scrollTop = 200
    sourceA.dispatchEvent(new Event('scroll'))
    expect(scoped.flush().outputs).toEqual([])
    expect(targetB.style.getPropertyValue('transform')).toBe('')
    scoped.dispose()

    const explicitlyGlobal = createDOMMotionDrivers({
      ...options,
      id: 'scope-a-custom',
      resolveElement: (id) => element(root.querySelector(`[data-node-id="${id}"]`) as FakeElement)
    })
    expect(explicitlyGlobal.driverIds).toEqual(['scoped'])
    expect(targetB.getAttribute('data-op-motion-driver-tracks')).toBe('track-scoped')
    explicitlyGlobal.dispose()
    expect(targetB.getAttribute('data-op-motion-driver-tracks')).toBeNull()
  })
})
