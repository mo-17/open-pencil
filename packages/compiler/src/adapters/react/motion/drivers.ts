import type { IRMotionDriverSpec } from '#compiler/ir/drivers'

export interface ReactMotionDriverEntry {
  readonly token: string
  readonly spec: IRMotionDriverSpec
}

export function motionDriverToken(spec: IRMotionDriverSpec): string {
  const source = JSON.stringify(spec)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < source.length; index++) {
    hash ^= BigInt(source.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `d-${hash.toString(36)}`
}

/** Build the zero-dependency DOM source adapter appended to the shared Motion runtime module. */
export function buildMotionDriversRuntime(entries: readonly ReactMotionDriverEntry[]): string {
  if (entries.length === 0) return ''
  const registry = Object.fromEntries(entries.map((entry) => [entry.token, entry.spec]))
  return `

type MotionDriverSource =
  | { kind: 'scroll'; sourceNodeId?: string; axis: 'x' | 'y'; metric: 'progress' | 'offset' }
  | { kind: 'pointer'; sourceNodeId?: string; axis: 'x' | 'y'; space: 'local' | 'viewport' }
  | { kind: 'drag'; handleNodeId: string; axis: 'x' | 'y'; distance: number }
  | { kind: 'visibility'; sourceNodeId: string }
  | { kind: 'pageState'; stateId: string }
  | { kind: 'documentState'; stateId: string }
  | { kind: 'variable'; variableId: string }
interface MotionDriverDefinition {
  id: string
  source: MotionDriverSource
  target: { targetNodeId: string; trackId: string }
  mapping: { inputMin: number; inputMax: number; clamp: boolean; reverse: boolean; deadZone: number }
}
interface MotionDriverSpec { version: 1; drivers: MotionDriverDefinition[] }
interface MountedMotionDrivers {
  owner: Element
  spec: MotionDriverSpec
  listeners: Array<{ target: EventTarget; type: string; listener: EventListener }>
  observer?: IntersectionObserver
  driven: Map<string, Element[]>
}
interface OpenPencilMotionDriversHandle {
  dispose(): void
  setPageState(stateId: string, value: number | boolean): number
  setDocumentState(stateId: string, value: number | boolean): number
  setVariable(variableId: string, value: number | boolean): number
}
type MotionDriverHostKind = 'pageState' | 'documentState' | 'variable'

const motionDriverRegistry: Record<string, MotionDriverSpec> = ${JSON.stringify(registry)}
const motionDriverSelector = '[data-op-motion-drivers]'
const mountedMotionDrivers = new Map<Element, MountedMotionDrivers>()
const pendingMotionDriverInputs = new Map<{ mount: MountedMotionDrivers; driver: MotionDriverDefinition }, number>()
const motionDriverHostValues = new Map<string, number | boolean>()
const motionDriverGlobal = globalThis as typeof globalThis & {
  __OPENPENCIL_MOTION_DRIVERS__?: OpenPencilMotionDriversHandle
}
motionDriverGlobal.__OPENPENCIL_MOTION_DRIVERS__?.dispose()
let motionDriverFrame: number | null = null

function motionDriverSpecFor(owner: Element): MotionDriverSpec | undefined {
  const token = owner.getAttribute('data-op-motion-drivers')
  return token ? motionDriverRegistry[token] : undefined
}

function motionDriverEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replaceAll('\\\\', '\\\\\\\\').replaceAll('"', '\\"')
}

function motionDriverElement(owner: Element, nodeId: string): HTMLElement | null {
  const query = '[data-node-id="' + motionDriverEscape(nodeId) + '"]'
  const scope = owner.closest('[data-op-motion-scope]') ?? owner
  if (scope.matches(query)) return scope as HTMLElement
  return scope.querySelector<HTMLElement>(query)
}

function mapMotionDriverValue(value: number | boolean, driver: MotionDriverDefinition): number | undefined {
  const input = typeof value === 'boolean' ? (value ? 1 : 0) : value
  if (!Number.isFinite(input)) return undefined
  const mapping = driver.mapping
  const outside = input < mapping.inputMin || input > mapping.inputMax
  if (!mapping.clamp && outside) return undefined
  let progress = Math.min(1, Math.max(0, (input - mapping.inputMin) / (mapping.inputMax - mapping.inputMin)))
  if (mapping.reverse) progress = 1 - progress
  if (mapping.deadZone > 0) {
    if (progress <= mapping.deadZone) progress = 0
    else if (progress >= 1 - mapping.deadZone) progress = 1
    else progress = (progress - mapping.deadZone) / (1 - mapping.deadZone * 2)
  }
  return Math.min(1, Math.max(0, progress))
}

function driveMotionTrack(element: Element, trackId: string, progress: number): void {
  restoreControlledTrackProgress(element, trackId, progress)
}

function releaseMotionDriverTarget(element: Element, trackId: string): void {
  forgetControlledTrackProgress(element, trackId)
  stopControlledElement(element, trackId)
  const stopped = automaticStopped.get(element)
  stopped?.delete(trackId)
  if (stopped?.size === 0) automaticStopped.delete(element)
  const track = specFor(element)?.tracks.find((candidate) => candidate.id === trackId)
  if (track?.css) cssStyleFor(element)?.removeProperty(track.css.variable)
}

function flushMotionDriverInputs(): void {
  motionDriverFrame = null
  const entries = [...pendingMotionDriverInputs.entries()]
  pendingMotionDriverInputs.clear()
  for (const [key, input] of entries) {
    if (mountedMotionDrivers.get(key.mount.owner) !== key.mount) continue
    const progress = mapMotionDriverValue(input, key.driver)
    const drivenKey = key.driver.target.targetNodeId + '\\u0000' + key.driver.target.trackId
    const previous = key.mount.driven.get(drivenKey) ?? []
    if (progress === undefined) {
      for (const element of previous) releaseMotionDriverTarget(element, key.driver.target.trackId)
      key.mount.driven.delete(drivenKey)
      continue
    }
    const target = motionDriverElement(key.mount.owner, key.driver.target.targetNodeId)
    if (!target) continue
    driveMotionTrack(target, key.driver.target.trackId, progress)
    key.mount.driven.set(drivenKey, [target])
  }
}

function queueMotionDriverInput(
  mount: MountedMotionDrivers,
  driver: MotionDriverDefinition,
  value: number | boolean
): void {
  let key = [...pendingMotionDriverInputs.keys()].find(
    (candidate) => candidate.mount === mount && candidate.driver === driver
  )
  if (!key) key = { mount, driver }
  pendingMotionDriverInputs.set(key, typeof value === 'boolean' ? (value ? 1 : 0) : value)
  if (motionDriverFrame === null) motionDriverFrame = requestAnimationFrame(flushMotionDriverInputs)
}

function motionDriverPointer(event: PointerEvent, axis: 'x' | 'y'): number {
  return axis === 'x' ? event.clientX : event.clientY
}

function mountMotionDriverOwner(owner: Element): void {
  if (mountedMotionDrivers.has(owner)) return
  const spec = motionDriverSpecFor(owner)
  if (!spec) return
  const mount: MountedMotionDrivers = { owner, spec, listeners: [], driven: new Map() }
  mountedMotionDrivers.set(owner, mount)
  const listen = (target: EventTarget | null, type: string, listener: EventListener): void => {
    if (!target) return
    target.addEventListener(type, listener, { passive: true })
    mount.listeners.push({ target, type, listener })
  }
  const visibility = new Map<Element, MotionDriverDefinition[]>()
  for (const driver of spec.drivers) {
    const drivenTarget = motionDriverElement(owner, driver.target.targetNodeId)
    const drivenTrack = drivenTarget
      ? specFor(drivenTarget)?.tracks.find((track) => track.id === driver.target.trackId)
      : undefined
    if (drivenTarget && drivenTrack) stopAutomaticTracks(drivenTarget, [drivenTrack])
    const source = driver.source
    if (source.kind === 'scroll') {
      const element = source.sourceNodeId ? motionDriverElement(owner, source.sourceNodeId) : null
      const target: EventTarget = element ?? window
      const update = () => {
        const offset = element
          ? source.axis === 'x' ? element.scrollLeft : element.scrollTop
          : source.axis === 'x' ? window.scrollX : window.scrollY
        if (source.metric === 'offset') return queueMotionDriverInput(mount, driver, offset)
        const extent = element
          ? source.axis === 'x'
            ? element.scrollWidth - element.clientWidth
            : element.scrollHeight - element.clientHeight
          : source.axis === 'x'
            ? document.documentElement.scrollWidth - window.innerWidth
            : document.documentElement.scrollHeight - window.innerHeight
        queueMotionDriverInput(mount, driver, extent <= 0 ? 0 : offset / extent)
      }
      listen(target, 'scroll', update)
      update()
    } else if (source.kind === 'pointer') {
      const local = source.sourceNodeId ? motionDriverElement(owner, source.sourceNodeId) : owner
      listen(source.space === 'viewport' ? window : local, 'pointermove', ((event: PointerEvent) => {
        const coordinate = motionDriverPointer(event, source.axis)
        const rect = local.getBoundingClientRect()
        const value = source.space === 'local'
          ? coordinate - (source.axis === 'x' ? rect.left : rect.top)
          : coordinate
        queueMotionDriverInput(mount, driver, value)
      }) as EventListener)
    } else if (source.kind === 'drag') {
      const handle = motionDriverElement(owner, source.handleNodeId)
      let activePointer: number | null = null
      let origin = 0
      listen(handle, 'pointerdown', ((event: PointerEvent) => {
        if (activePointer !== null) return
        activePointer = event.pointerId
        origin = motionDriverPointer(event, source.axis)
        queueMotionDriverInput(mount, driver, 0)
      }) as EventListener)
      listen(window, 'pointermove', ((event: PointerEvent) => {
        if (event.pointerId !== activePointer) return
        queueMotionDriverInput(
          mount,
          driver,
          (motionDriverPointer(event, source.axis) - origin) / source.distance
        )
      }) as EventListener)
      const end = ((event: PointerEvent) => {
        if (event.pointerId === activePointer) activePointer = null
      }) as EventListener
      listen(window, 'pointerup', end)
      listen(window, 'pointercancel', end)
    } else if (source.kind === 'visibility') {
      const element = motionDriverElement(owner, source.sourceNodeId)
      if (element) visibility.set(element, [...(visibility.get(element) ?? []), driver])
    }
    const hostBinding = motionDriverHostBinding(source)
    if (hostBinding) {
      const value = motionDriverHostValues.get(motionDriverHostKey(hostBinding.kind, hostBinding.id))
      if (value !== undefined) queueMotionDriverInput(mount, driver, value)
    }
  }
  if (visibility.size > 0 && typeof IntersectionObserver === 'function') {
    mount.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        for (const driver of visibility.get(entry.target) ?? []) {
          queueMotionDriverInput(mount, driver, entry.isIntersecting ? entry.intersectionRatio : 0)
        }
      }
    })
    for (const element of visibility.keys()) mount.observer.observe(element)
  }
}

function unmountMotionDriverOwner(owner: Element): void {
  const mount = mountedMotionDrivers.get(owner)
  if (!mount) return
  mountedMotionDrivers.delete(owner)
  mount.observer?.disconnect()
  for (const { target, type, listener } of mount.listeners) target.removeEventListener(type, listener)
  for (const [key, elements] of mount.driven) {
    const trackId = key.slice(key.indexOf('\\u0000') + 1)
    for (const element of elements) releaseMotionDriverTarget(element, trackId)
  }
  for (const key of pendingMotionDriverInputs.keys()) {
    if (key.mount === mount) pendingMotionDriverInputs.delete(key)
  }
}

function scanMotionDriverOwners(root: ParentNode): void {
  if (root instanceof Element && root.matches(motionDriverSelector)) mountMotionDriverOwner(root)
  for (const owner of root.querySelectorAll(motionDriverSelector)) mountMotionDriverOwner(owner)
}

function unmountMotionDriverTree(root: ParentNode): void {
  if (root instanceof Element) unmountMotionDriverOwner(root)
  for (const owner of root.querySelectorAll(motionDriverSelector)) unmountMotionDriverOwner(owner)
}

function motionDriverHostKey(kind: MotionDriverHostKind, id: string): string {
  return kind + '\\u0000' + id
}

function motionDriverHostBinding(
  source: MotionDriverSource
): { kind: MotionDriverHostKind; id: string } | undefined {
  if (source.kind === 'pageState' || source.kind === 'documentState') {
    return { kind: source.kind, id: source.stateId }
  }
  return source.kind === 'variable' ? { kind: source.kind, id: source.variableId } : undefined
}

function setMotionDriverHostValue(
  kind: MotionDriverHostKind,
  id: string,
  value: number | boolean
): number {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256 || id.includes('\\u0000')) {
    throw new RangeError('Motion driver host id must be a non-empty bounded string')
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('Motion driver host value must be finite')
  }
  motionDriverHostValues.set(motionDriverHostKey(kind, id), value)
  let count = 0
  for (const mount of mountedMotionDrivers.values()) {
    for (const driver of mount.spec.drivers) {
      const source = driver.source
      const matches =
        (kind === 'pageState' && source.kind === 'pageState' && source.stateId === id) ||
        (kind === 'documentState' && source.kind === 'documentState' && source.stateId === id) ||
        (kind === 'variable' && source.kind === 'variable' && source.variableId === id)
      if (!matches) continue
      queueMotionDriverInput(mount, driver, value)
      count++
    }
  }
  return count
}

const motionDriverMutationObserver = typeof MutationObserver === 'function'
  ? new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') unmountMotionDriverOwner(record.target as Element)
        for (const node of record.removedNodes) if (node instanceof Element) unmountMotionDriverTree(node)
      }
      for (const record of records) {
        if (record.type === 'attributes') mountMotionDriverOwner(record.target as Element)
        for (const node of record.addedNodes) if (node instanceof Element) scanMotionDriverOwners(node)
      }
    })
  : null
if (runtimeDocument) {
  scanMotionDriverOwners(runtimeDocument)
  motionDriverMutationObserver?.observe(runtimeDocument.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-op-motion-drivers']
  })
}

const motionDriversHandle: OpenPencilMotionDriversHandle = {
  setPageState: (id, value) => setMotionDriverHostValue('pageState', id, value),
  setDocumentState: (id, value) => setMotionDriverHostValue('documentState', id, value),
  setVariable: (id, value) => setMotionDriverHostValue('variable', id, value),
  dispose() {
    motionDriverMutationObserver?.disconnect()
    for (const owner of [...mountedMotionDrivers.keys()]) unmountMotionDriverOwner(owner)
    if (motionDriverFrame !== null) cancelAnimationFrame(motionDriverFrame)
    motionDriverFrame = null
    pendingMotionDriverInputs.clear()
    motionDriverHostValues.clear()
    if (motionDriverGlobal.__OPENPENCIL_MOTION_DRIVERS__ === motionDriversHandle) {
      delete motionDriverGlobal.__OPENPENCIL_MOTION_DRIVERS__
    }
  }
}
motionDriverGlobal.__OPENPENCIL_MOTION_DRIVERS__ = motionDriversHandle
runtimeDocument?.defaultView?.dispatchEvent(new Event('op-motion-drivers-ready'))
hot?.dispose(() => motionDriversHandle.dispose())
`
}
