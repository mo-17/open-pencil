import {
  MotionInputController,
  type MotionDriverPlanIssue,
  type MotionInputBatch,
  type MotionInputFrameScheduler,
  type MotionInputTargetState
} from '@open-pencil/core/motion'
import {
  parseMotionDriverSpec,
  type MotionDriver,
  type MotionDriverSpecV1,
  type MotionSpec
} from '@open-pencil/scene-graph'

import { createDOMMotionTarget, type DOMMotionTarget, type DOMMotionTargetOptions } from './dom'

export const MOTION_DOM_DRIVER_LIMITS = Object.freeze({
  maxScopeIdLength: 128,
  maxStateIdLength: 256
})

export interface MotionDriverDOMElement extends Element {
  readonly style: CSSStyleDeclaration
  readonly clientWidth: number
  readonly clientHeight: number
  readonly scrollWidth: number
  readonly scrollHeight: number
  readonly scrollLeft: number
  readonly scrollTop: number
  getBoundingClientRect(): DOMRect
}

export interface MotionDriverViewport extends EventTarget {
  readonly innerWidth: number
  readonly innerHeight: number
  readonly scrollX: number
  readonly scrollY: number
  readonly document: Document
}

export interface MotionDriverVisibilityEntry {
  readonly target: Element
  readonly intersectionRatio: number
  readonly isIntersecting: boolean
}

export interface MotionDriverVisibilityObserver {
  observe(target: Element): void
  unobserve(target: Element): void
  disconnect(): void
}

export type MotionDriverVisibilityObserverFactory = (
  callback: (entries: readonly MotionDriverVisibilityEntry[]) => void
) => MotionDriverVisibilityObserver

export interface DOMMotionDriversOptions extends DOMMotionTargetOptions {
  readonly id: string
  readonly owner: Element
  readonly spec: MotionDriverSpecV1
  /**
   * Optional authoritative resolver. The default never leaves the owner's nearest Motion scope;
   * a custom resolver may intentionally cross scopes.
   */
  readonly resolveElement?: (nodeId: string, owner: Element) => MotionDriverDOMElement | undefined
  readonly resolveMotion: (nodeId: string, owner: Element) => MotionSpec | undefined
  readonly root?: ParentNode
  readonly viewport?: MotionDriverViewport
  readonly scheduler?: MotionInputFrameScheduler
  readonly prefersReducedMotion?: boolean
  readonly createVisibilityObserver?: MotionDriverVisibilityObserverFactory
  readonly onBatch?: (batch: MotionInputBatch) => void
  readonly onIssues?: (issues: readonly MotionDriverPlanIssue[]) => void
}

export interface DOMMotionDriversController {
  readonly issues: readonly MotionDriverPlanIssue[]
  readonly driverIds: readonly string[]
  setPageState(stateId: string, value: number | boolean): number
  setDocumentState(stateId: string, value: number | boolean): number
  setVariable(variableId: string, value: number | boolean): number
  flush(): MotionInputBatch
  dispose(): void
}

interface BoundTarget {
  readonly state: MotionInputTargetState
  readonly target: DOMMotionTarget
  readonly element: MotionDriverDOMElement
}

interface SourceIndex {
  readonly pageState: ReadonlyMap<string, readonly string[]>
  readonly documentState: ReadonlyMap<string, readonly string[]>
  readonly variable: ReadonlyMap<string, readonly string[]>
}

function validateHostKey(value: string, label: string, maxLength: number): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.includes('\u0000')
  ) {
    throw new RangeError(`${label} must be a non-empty bounded string`)
  }
}

function cssEscape(value: string): string {
  const css = Reflect.get(globalThis, 'CSS') as
    | { escape?: (candidate: string) => string }
    | undefined
  const escape = css?.escape
  if (escape) return escape(value)
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function defaultResolveElement(nodeId: string, owner: Element): MotionDriverDOMElement | undefined {
  const selector = `[data-node-id="${cssEscape(nodeId)}"]`
  const scope = owner.closest('[data-op-motion-scope]') ?? owner
  const local = (
    scope.matches(selector) ? scope : scope.querySelector(selector)
  ) as MotionDriverDOMElement | null
  return local ?? undefined
}

function defaultViewport(root: ParentNode): MotionDriverViewport | undefined {
  const document =
    typeof Document !== 'undefined' && root instanceof Document ? root : root.ownerDocument
  const view = document?.defaultView
  return (view as MotionDriverViewport | null) ?? undefined
}

function defaultVisibilityObserver(
  callback: (entries: readonly MotionDriverVisibilityEntry[]) => void
): MotionDriverVisibilityObserver | undefined {
  if (typeof globalThis.IntersectionObserver !== 'function') return undefined
  return new globalThis.IntersectionObserver((entries) => callback(entries))
}

function appendIndex(index: Map<string, string[]>, id: string, driverId: string): void {
  const values = index.get(id) ?? []
  values.push(driverId)
  index.set(id, values)
}

function sourceIndex(drivers: readonly MotionDriver[]): SourceIndex {
  const index = {
    pageState: new Map<string, string[]>(),
    documentState: new Map<string, string[]>(),
    variable: new Map<string, string[]>()
  }
  for (const driver of drivers) {
    const source = driver.source
    if (source.kind === 'pageState') appendIndex(index.pageState, source.stateId, driver.id)
    else if (source.kind === 'documentState') {
      appendIndex(index.documentState, source.stateId, driver.id)
    } else if (source.kind === 'variable') appendIndex(index.variable, source.variableId, driver.id)
  }
  return index
}

function pointerCoordinate(event: PointerEvent, axis: 'x' | 'y'): number {
  return axis === 'x' ? event.clientX : event.clientY
}

function localPointerCoordinate(
  event: PointerEvent,
  source: MotionDriverDOMElement,
  axis: 'x' | 'y'
): number {
  const rect = source.getBoundingClientRect()
  return pointerCoordinate(event, axis) - (axis === 'x' ? rect.left : rect.top)
}

function scrollValue(
  source: MotionDriverDOMElement | MotionDriverViewport,
  axis: 'x' | 'y',
  metric: 'progress' | 'offset'
): number {
  const viewport = 'document' in source
  const horizontal = axis === 'x'
  let offset: number
  if (viewport) offset = horizontal ? source.scrollX : source.scrollY
  else offset = horizontal ? source.scrollLeft : source.scrollTop
  if (metric === 'offset') return offset
  let extent: number
  if (viewport) {
    extent = horizontal
      ? source.document.documentElement.scrollWidth - source.innerWidth
      : source.document.documentElement.scrollHeight - source.innerHeight
  } else {
    extent = horizontal
      ? source.scrollWidth - source.clientWidth
      : source.scrollHeight - source.clientHeight
  }
  return extent <= 0 ? 0 : Math.min(1, Math.max(0, offset / extent))
}

function restoreTargets(targets: Iterable<BoundTarget>): void {
  for (const { target } of targets) target.restore()
}

type ResolveDriverElement = (nodeId: string) => MotionDriverDOMElement | undefined
type RegisterDriverListener = (
  target: EventTarget | undefined,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions | boolean
) => void

function bindDriverTargets(
  options: DOMMotionDriversOptions,
  spec: MotionDriverSpecV1,
  registeredIds: ReadonlySet<string>,
  resolveElement: ResolveDriverElement,
  targets: Map<string, BoundTarget>,
  markerSnapshots: Map<Element, string | null>
): void {
  for (const driver of spec.drivers) {
    if (!registeredIds.has(driver.id)) continue
    const element = resolveElement(driver.target.targetNodeId)
    const motion = options.resolveMotion(driver.target.targetNodeId, options.owner)
    const track = motion?.tracks.find((candidate) => candidate.id === driver.target.trackId)
    if (!element || !motion || !track) continue
    const state: MotionInputTargetState = {
      targetNodeId: driver.target.targetNodeId,
      resolvedNodeId: driver.target.targetNodeId,
      trackId: driver.target.trackId,
      authoredTrigger: track.trigger,
      automaticTriggerSuppressed: true
    }
    targets.set(`${state.resolvedNodeId}\u0000${state.trackId}`, {
      state,
      element,
      target: createDOMMotionTarget(element, options)
    })
    const current = element.getAttribute('data-op-motion-driver-tracks')
    if (!markerSnapshots.has(element)) markerSnapshots.set(element, current)
    const trackIds = new Set((current ?? '').split(' ').filter(Boolean))
    trackIds.add(driver.target.trackId)
    element.setAttribute('data-op-motion-driver-tracks', [...trackIds].sort().join(' '))
  }
}

function bindDriverInputSources(
  options: DOMMotionDriversOptions,
  spec: MotionDriverSpecV1,
  registeredIds: ReadonlySet<string>,
  controller: MotionInputController,
  viewport: MotionDriverViewport | undefined,
  resolveElement: ResolveDriverElement,
  listen: RegisterDriverListener
): Map<Element, string[]> {
  const visibilityDrivers = new Map<Element, string[]>()
  for (const driver of spec.drivers) {
    if (!registeredIds.has(driver.id)) continue
    const key = { scopeId: options.id, driverId: driver.id }
    const source = driver.source
    if (source.kind === 'scroll') {
      const scrollSource = source.sourceNodeId ? resolveElement(source.sourceNodeId) : viewport
      const update = () => {
        if (scrollSource) {
          controller.setInput(key, scrollValue(scrollSource, source.axis, source.metric))
        }
      }
      listen(scrollSource, 'scroll', update, { passive: true })
      update()
    } else if (source.kind === 'pointer') {
      const localSource = source.sourceNodeId
        ? resolveElement(source.sourceNodeId)
        : (options.owner as MotionDriverDOMElement)
      const eventSource = source.space === 'viewport' ? viewport : localSource
      listen(
        eventSource,
        'pointermove',
        ((event: PointerEvent) => {
          const value =
            source.space === 'local' && localSource
              ? localPointerCoordinate(event, localSource, source.axis)
              : pointerCoordinate(event, source.axis)
          controller.setInput(key, value)
        }) as EventListener,
        { passive: true }
      )
    } else if (source.kind === 'drag') {
      bindDragDriver(source, key, controller, viewport, resolveElement, listen)
    } else if (source.kind === 'visibility') {
      const element = resolveElement(source.sourceNodeId)
      if (element) {
        const ids = visibilityDrivers.get(element) ?? []
        ids.push(driver.id)
        visibilityDrivers.set(element, ids)
      }
    }
  }
  return visibilityDrivers
}

function bindDragDriver(
  source: Extract<MotionDriver['source'], { kind: 'drag' }>,
  key: { scopeId: string; driverId: string },
  controller: MotionInputController,
  viewport: MotionDriverViewport | undefined,
  resolveElement: ResolveDriverElement,
  listen: RegisterDriverListener
): void {
  const handle = resolveElement(source.handleNodeId)
  let pointerId: number | undefined
  let origin = 0
  listen(handle, 'pointerdown', ((event: PointerEvent) => {
    if (pointerId !== undefined) return
    pointerId = event.pointerId
    origin = pointerCoordinate(event, source.axis)
    controller.setInput(key, 0)
  }) as EventListener)
  listen(
    viewport,
    'pointermove',
    ((event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      controller.setInput(key, (pointerCoordinate(event, source.axis) - origin) / source.distance)
    }) as EventListener,
    { passive: true }
  )
  const end = ((event: PointerEvent) => {
    if (event.pointerId === pointerId) pointerId = undefined
  }) as EventListener
  listen(viewport, 'pointerup', end)
  listen(viewport, 'pointercancel', end)
}

/**
 * Mount bounded continuous inputs for one page/frame/component owner. Browser listeners only feed
 * the shared reference MotionInputController; it performs the single-rAF coalescing and sampling.
 * State and variable sources are deliberately write-only host bridges and never inspect app globals.
 */
export function createDOMMotionDrivers(
  options: DOMMotionDriversOptions
): DOMMotionDriversController {
  validateHostKey(options.id, 'Motion driver scope id', MOTION_DOM_DRIVER_LIMITS.maxScopeIdLength)
  const spec = parseMotionDriverSpec(options.spec)
  const root = options.root ?? options.owner.ownerDocument
  const viewport = options.viewport ?? defaultViewport(root)
  const resolveElement = options.resolveElement
    ? (nodeId: string) => options.resolveElement?.(nodeId, options.owner)
    : (nodeId: string) => defaultResolveElement(nodeId, options.owner)
  const targets = new Map<string, BoundTarget>()
  const listeners: Array<{
    target: EventTarget
    type: string
    listener: EventListener
    options?: AddEventListenerOptions | boolean
  }> = []
  const markerSnapshots = new Map<Element, string | null>()
  let disposed = false

  const controller = new MotionInputController({
    scheduler: options.scheduler,
    prefersReducedMotion: options.prefersReducedMotion,
    onUpdate(batch) {
      for (const output of batch.outputs) {
        const key = `${output.target.resolvedNodeId}\u0000${output.target.trackId}`
        const bound = targets.get(key)
        if (!bound) continue
        if (output.active) bound.target.apply(output.sample.visual)
        else bound.target.restore()
      }
      options.onBatch?.(batch)
    }
  })
  const registration = controller.register(options.id, spec, (targetNodeId) => {
    const motion = options.resolveMotion(targetNodeId, options.owner)
    const element = resolveElement(targetNodeId)
    return motion && element ? { nodeId: targetNodeId, motion } : undefined
  })
  const registeredIds = new Set(registration.driverIds)
  bindDriverTargets(options, spec, registeredIds, resolveElement, targets, markerSnapshots)

  function listen(
    target: EventTarget | undefined,
    type: string,
    listener: EventListener,
    eventOptions?: AddEventListenerOptions | boolean
  ): void {
    if (!target) return
    target.addEventListener(type, listener, eventOptions)
    listeners.push({ target, type, listener, options: eventOptions })
  }

  const visibilityDrivers = bindDriverInputSources(
    options,
    spec,
    registeredIds,
    controller,
    viewport,
    resolveElement,
    listen
  )

  const observerFactory = options.createVisibilityObserver ?? defaultVisibilityObserver
  const visibilityObserver =
    visibilityDrivers.size === 0
      ? undefined
      : observerFactory((entries) => {
          for (const entry of entries) {
            const value = entry.isIntersecting
              ? Math.min(1, Math.max(0, entry.intersectionRatio))
              : 0
            for (const driverId of visibilityDrivers.get(entry.target) ?? []) {
              controller.setInput({ scopeId: options.id, driverId }, value)
            }
          }
        })
  for (const element of visibilityDrivers.keys()) visibilityObserver?.observe(element)

  const indexedSources = sourceIndex(spec.drivers.filter((driver) => registeredIds.has(driver.id)))
  const setHostInputs = (
    index: ReadonlyMap<string, readonly string[]>,
    id: string,
    value: number | boolean,
    label: string
  ): number => {
    if (disposed) throw new Error('Motion DOM drivers are disposed')
    validateHostKey(id, label, MOTION_DOM_DRIVER_LIMITS.maxStateIdLength)
    const driverIds = index.get(id) ?? []
    let count = 0
    for (const driverId of driverIds) {
      if (controller.setInput({ scopeId: options.id, driverId }, value)) count++
    }
    return count
  }

  options.onIssues?.(registration.issues)
  const result: DOMMotionDriversController = {
    issues: registration.issues,
    driverIds: registration.driverIds,
    setPageState: (id: string, value: number | boolean) =>
      setHostInputs(indexedSources.pageState, id, value, 'Page state id'),
    setDocumentState: (id: string, value: number | boolean) =>
      setHostInputs(indexedSources.documentState, id, value, 'Document state id'),
    setVariable: (id: string, value: number | boolean) =>
      setHostInputs(indexedSources.variable, id, value, 'Variable id'),
    flush: () => controller.flush(),
    dispose() {
      if (disposed) return
      disposed = true
      visibilityObserver?.disconnect()
      for (const record of listeners) {
        record.target.removeEventListener(record.type, record.listener, record.options)
      }
      registration.dispose()
      restoreTargets(targets.values())
      for (const [element, snapshot] of markerSnapshots) {
        if (snapshot === null) element.removeAttribute('data-op-motion-driver-tracks')
        else element.setAttribute('data-op-motion-driver-tracks', snapshot)
      }
      controller.dispose()
      targets.clear()
    }
  }
  return Object.freeze(result)
}

export const createVanillaMotionDrivers = createDOMMotionDrivers
