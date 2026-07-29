import type { ComponentDef, IRMotionScene, IRNode, IRTree } from '#compiler/ir/types'

interface ReactMotionSceneEntry {
  ownerId: string
  scene: IRMotionScene
}

/**
 * Append a page-scoped scene controller to the generated Motion module. It deliberately reuses
 * the base runtime's WAAPI projection and wait/cancel primitives, so cue timing is the only scene
 * concern and node-local channel semantics retain one implementation.
 */
export function buildMotionSceneRuntime(
  irs: readonly IRTree[],
  components: readonly ComponentDef[] = []
): string {
  const entries = collectMotionSceneEntries(irs, components)
  if (entries.length === 0) return ''
  const registry = Object.fromEntries(entries.map((entry) => [entry.ownerId, entry.scene]))

  return `

type MotionSceneTrigger = 'pageEnter' | 'pageExit' | 'manual'
type MotionSceneRunStatus = 'running' | 'finished' | 'stopped' | 'timeout' | 'missing'

interface MotionSceneCue {
  id: string
  targetNodeId: string
  trackId: string
  startMs: number
  timeScale: number
}

interface MotionSceneSequence {
  id: string
  trigger: MotionSceneTrigger
  cues: MotionSceneCue[]
  durationMs: number
}

interface MotionSceneSpec {
  id: string
  sequences: MotionSceneSequence[]
}

interface MotionScenePlayOptions {
  scope?: Element
  timeoutMs?: number
}

interface MotionSceneCompletion {
  status: Exclude<MotionSceneRunStatus, 'running'>
  runId?: string
  ownerId: string
  sequenceId: string
  cueCount: number
  animationCount: number
}

interface MotionScenePlayResult {
  status: MotionSceneRunStatus
  runId?: string
  ownerId: string
  sequenceId: string
  cueCount: number
  animationCount: number
  finished: Promise<MotionSceneCompletion>
}

interface MotionSceneDebugRun {
  runId: string
  ownerId: string
  sequenceId: string
  trigger: MotionSceneTrigger
  status: Exclude<MotionSceneRunStatus, 'missing'>
  cueCount: number
  animationCount: number
}

interface MotionSceneDebugSnapshot {
  activeRunCount: number
  runs: readonly MotionSceneDebugRun[]
}

interface OpenPencilMotionSceneRuntimeHandle {
  dispose: () => void
  inspect: (ownerId?: string, scope?: Element) => MotionSceneDebugSnapshot
  pageExit: (options?: MotionPageExitOptions) => Promise<MotionPageExitResult>
  play: (
    ownerId: string,
    sequenceId: string,
    options?: MotionScenePlayOptions
  ) => MotionScenePlayResult
  stop: (ownerId: string, sequenceId?: string, scope?: Element) => number
}

interface MotionSceneRunRecord {
  runId: string
  ownerId: string
  sequenceId: string
  trigger: MotionSceneTrigger
  root: Element
  cueCount: number
  animations: Animation[]
  watches: MotionAnimationWait[]
  status: Exclude<MotionSceneRunStatus, 'missing'>
  finished: Promise<MotionSceneCompletion>
  settle: (status: Exclude<MotionSceneRunStatus, 'running' | 'missing'>) => void
  timeoutId?: ReturnType<typeof setTimeout>
}

declare global {
  interface Window {
    __OPENPENCIL_MOTION_SCENE_RUNTIME__?: OpenPencilMotionSceneRuntimeHandle
  }
}

const motionSceneRegistry: Record<string, MotionSceneSpec> = ${JSON.stringify(registry)}
const motionSceneGlobal = globalThis as typeof globalThis & {
  __OPENPENCIL_MOTION_SCENE_RUNTIME__?: OpenPencilMotionSceneRuntimeHandle
}
motionSceneGlobal.__OPENPENCIL_MOTION_SCENE_RUNTIME__?.dispose()
const motionSceneOwnerSelector = '[data-op-motion-scene-owner]'
const motionSceneRuns = new Map<string, MotionSceneRunRecord>()
const enteredMotionScenePages = new WeakSet<Element>()
const baseMotionPageExit = runtimeHandle.pageExit
const baseMotionDispose = runtimeHandle.dispose
const MOTION_SCENE_PAGE_EXIT_MAX_WAIT_MS = 4_000
let nextMotionSceneRunId = 0
let motionSceneDisposed = false

function motionSceneRoots(root: ParentNode): Element[] {
  const roots: Element[] = []
  if (root instanceof Element && root.matches(motionSceneOwnerSelector)) roots.push(root)
  roots.push(...root.querySelectorAll(motionSceneOwnerSelector))
  return roots
}

function motionSceneRoot(ownerId: string, scope?: Element): Element | undefined {
  if (!runtimeDocument || typeof ownerId !== 'string' || ownerId.length === 0) return undefined
  const roots = motionSceneRoots(scope ?? runtimeDocument).filter(
    (root) => root.getAttribute('data-op-motion-scene-owner') === ownerId
  )
  return roots.length === 1 ? roots[0] : undefined
}

function motionSceneSequence(
  ownerId: string,
  sequenceId: string
): MotionSceneSequence | undefined {
  if (!sequenceId) return undefined
  return motionSceneRegistry[ownerId]?.sequences.find((sequence) => sequence.id === sequenceId)
}

function missingMotionSceneResult(ownerId: string, sequenceId: string): MotionScenePlayResult {
  const completion: MotionSceneCompletion = {
    status: 'missing',
    ownerId,
    sequenceId,
    cueCount: 0,
    animationCount: 0
  }
  return { ...completion, finished: Promise.resolve(completion) }
}

function completionFor(
  run: MotionSceneRunRecord,
  status: MotionSceneCompletion['status']
): MotionSceneCompletion {
  return {
    status,
    runId: run.runId,
    ownerId: run.ownerId,
    sequenceId: run.sequenceId,
    cueCount: run.cueCount,
    animationCount: run.animations.length
  }
}

function stopMotionSceneRun(run: MotionSceneRunRecord): void {
  if (run.timeoutId !== undefined) clearTimeout(run.timeoutId)
  for (const watch of run.watches) watch.cancel()
  for (const animation of run.animations) cancelAnimation(animation)
  motionSceneRuns.delete(run.runId)
  if (run.status === 'running') run.settle('stopped')
}

function stopMotionSceneRuns(
  root: Element,
  ownerId?: string,
  sequenceId?: string
): number {
  const selected = [...motionSceneRuns.values()].filter(
    (run) =>
      run.root === root &&
      (ownerId === undefined || run.ownerId === ownerId) &&
      (sequenceId === undefined || run.sequenceId === sequenceId)
  )
  for (const run of selected) stopMotionSceneRun(run)
  return selected.length
}

function boundedMotionSceneTimeout(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(120_000, value))
}

function startMotionSceneSequence(
  ownerId: string,
  sequence: MotionSceneSequence,
  root: Element,
  timeoutMs?: number
): MotionScenePlayResult {
  stopMotionSceneRuns(root, ownerId, sequence.id)
  const animations: Animation[] = []
  let cueCount = 0
  for (const cue of sequence.cues) {
    const playback = playMotionSceneCue(
      cue.targetNodeId,
      cue.trackId,
      cue.startMs,
      cue.timeScale,
      root
    )
    if (playback.matchedElementCount > 0) cueCount += 1
    animations.push(...playback.animations)
  }
  if (sequence.cues.length > 0 && cueCount === 0) {
    return missingMotionSceneResult(ownerId, sequence.id)
  }

  const runId = ownerId + ':' + sequence.id + ':' + String(++nextMotionSceneRunId)
  let resolveFinished: (result: MotionSceneCompletion) => void = () => {}
  const finished = new Promise<MotionSceneCompletion>((resolve) => {
    resolveFinished = resolve
  })
  const run: MotionSceneRunRecord = {
    runId,
    ownerId,
    sequenceId: sequence.id,
    trigger: sequence.trigger,
    root,
    cueCount,
    animations,
    watches: animations.map(watchAnimation),
    status: animations.length > 0 ? 'running' : 'finished',
    finished,
    settle(status) {
      if (run.status !== 'running') return
      run.status = status
      if (run.timeoutId !== undefined) clearTimeout(run.timeoutId)
      for (const watch of run.watches) watch.cancel()
      resolveFinished(completionFor(run, status))
    }
  }
  motionSceneRuns.set(runId, run)

  if (animations.length === 0) {
    const completion = completionFor(run, 'finished')
    resolveFinished(completion)
    return { ...completion, finished }
  }
  void Promise.all(run.watches.map((watch) => watch.promise)).then((statuses) => {
    run.settle(statuses.some((status) => status === 'stopped') ? 'stopped' : 'finished')
  })
  const boundedTimeout = boundedMotionSceneTimeout(timeoutMs)
  if (boundedTimeout !== undefined) {
    run.timeoutId = setTimeout(() => {
      for (const animation of run.animations) cancelAnimation(animation)
      run.settle('timeout')
    }, boundedTimeout)
  }
  return {
    status: 'running',
    runId,
    ownerId,
    sequenceId: sequence.id,
    cueCount,
    animationCount: animations.length,
    finished
  }
}

function playMotionScene(
  ownerId: string,
  sequenceId: string,
  options: MotionScenePlayOptions = {}
): MotionScenePlayResult {
  const sequence = motionSceneSequence(ownerId, sequenceId)
  const root = motionSceneRoot(ownerId, options.scope)
  if (!sequence || sequence.trigger !== 'manual' || !root) {
    return missingMotionSceneResult(ownerId, sequenceId)
  }
  return startMotionSceneSequence(ownerId, sequence, root, options.timeoutMs)
}

function stopMotionScene(ownerId: string, sequenceId?: string, scope?: Element): number {
  const root = motionSceneRoot(ownerId, scope)
  return root ? stopMotionSceneRuns(root, ownerId, sequenceId) : 0
}

function enterMotionScenePage(root: Element): void {
  if (enteredMotionScenePages.has(root)) return
  enteredMotionScenePages.add(root)
  const ownerId = root.getAttribute('data-op-motion-scene-owner') ?? ''
  const scene = motionSceneRegistry[ownerId]
  if (!scene) return
  for (const sequence of scene.sequences) {
    if (sequence.trigger === 'pageEnter') startMotionSceneSequence(ownerId, sequence, root)
  }
}

function cleanupMotionScenePage(root: Element): void {
  enteredMotionScenePages.delete(root)
  stopMotionSceneRuns(root)
}

function scanMotionScenePages(root: ParentNode): void {
  for (const page of motionSceneRoots(root)) enterMotionScenePage(page)
}

function inspectMotionScenes(ownerId?: string, scope?: Element): MotionSceneDebugSnapshot {
  const runs = [...motionSceneRuns.values()]
    .filter(
      (run) =>
        (ownerId === undefined || run.ownerId === ownerId) &&
        (scope === undefined || scope === run.root || scope.contains(run.root))
    )
    .map((run) => ({
      runId: run.runId,
      ownerId: run.ownerId,
      sequenceId: run.sequenceId,
      trigger: run.trigger,
      status: run.status,
      cueCount: run.cueCount,
      animationCount: run.animations.length
    }))
  return {
    activeRunCount: runs.filter((run) => run.status === 'running').length,
    runs: Object.freeze(runs)
  }
}

function motionSceneExitTimeout(options: MotionPageExitOptions): number {
  const requested = options.timeoutMs
  return typeof requested === 'number' && Number.isFinite(requested)
    ? Math.max(0, Math.min(MOTION_SCENE_PAGE_EXIT_MAX_WAIT_MS, requested))
    : MOTION_SCENE_PAGE_EXIT_MAX_WAIT_MS
}

async function runMotionScenePageExit(
  options: MotionPageExitOptions = {}
): Promise<MotionPageExitResult> {
  if (!runtimeDocument) return { status: 'missing', trackCount: 0, animationCount: 0 }
  const starts: MotionScenePlayResult[] = []
  for (const root of motionSceneRoots(runtimeDocument)) {
    const ownerId = root.getAttribute('data-op-motion-scene-owner') ?? ''
    const scene = motionSceneRegistry[ownerId]
    if (!scene) continue
    stopMotionSceneRuns(root)
    for (const sequence of scene.sequences) {
      if (sequence.trigger !== 'pageExit') continue
      starts.push(
        startMotionSceneSequence(ownerId, sequence, root, motionSceneExitTimeout(options))
      )
    }
  }
  if (starts.length === 0) return { status: 'missing', trackCount: 0, animationCount: 0 }
  const completions = await Promise.all(starts.map((start) => start.finished))
  const statuses = completions.map((completion) => completion.status)
  const status: MotionWaitStatus = statuses.includes('timeout')
    ? 'timeout'
    : statuses.includes('stopped')
      ? 'stopped'
      : statuses.every((candidate) => candidate === 'missing')
        ? 'missing'
        : 'finished'
  return {
    status,
    trackCount: completions.reduce((sum, completion) => sum + completion.cueCount, 0),
    animationCount: completions.reduce(
      (sum, completion) => sum + completion.animationCount,
      0
    )
  }
}

function combineMotionPageExitResults(
  nodeResult: MotionPageExitResult,
  sceneResult: MotionPageExitResult
): MotionPageExitResult {
  const statuses = [nodeResult.status, sceneResult.status]
  const status: MotionWaitStatus = statuses.includes('timeout')
    ? 'timeout'
    : statuses.includes('stopped')
      ? 'stopped'
      : statuses.every((candidate) => candidate === 'missing')
        ? 'missing'
        : 'finished'
  return {
    status,
    trackCount: nodeResult.trackCount + sceneResult.trackCount,
    animationCount: nodeResult.animationCount + sceneResult.animationCount
  }
}

async function combinedMotionPageExit(
  options: MotionPageExitOptions = {}
): Promise<MotionPageExitResult> {
  const [nodeResult, sceneResult] = await Promise.all([
    baseMotionPageExit(options),
    runMotionScenePageExit(options)
  ])
  return combineMotionPageExitResults(nodeResult, sceneResult)
}

function refreshMotionScenesForReducedMotion(): void {
  if (!runtimeDocument) return
  const roots = motionSceneRoots(runtimeDocument)
  for (const root of roots) cleanupMotionScenePage(root)
  for (const root of roots) enterMotionScenePage(root)
}

const motionSceneMutationObserver =
  runtimeDocument && typeof MutationObserver !== 'undefined'
    ? new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'attributes') cleanupMotionScenePage(record.target as Element)
          for (const node of record.removedNodes) {
            if (!(node instanceof Element)) continue
            for (const root of motionSceneRoots(node)) cleanupMotionScenePage(root)
          }
        }
        for (const record of records) {
          if (record.type === 'attributes') scanMotionScenePages(record.target as Element)
          for (const node of record.addedNodes) {
            if (node instanceof Element) scanMotionScenePages(node)
          }
        }
      })
    : null

if (motionSceneMutationObserver && runtimeDocument) {
  motionSceneMutationObserver.observe(runtimeDocument.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-op-motion-scene-owner']
  })
}
reducedMotionQuery?.addEventListener('change', refreshMotionScenesForReducedMotion)
if (runtimeDocument) scanMotionScenePages(runtimeDocument)

function disposeMotionSceneRuntime(restoreBase = true): void {
  if (motionSceneDisposed) return
  motionSceneDisposed = true
  reducedMotionQuery?.removeEventListener('change', refreshMotionScenesForReducedMotion)
  motionSceneMutationObserver?.disconnect()
  for (const run of [...motionSceneRuns.values()]) stopMotionSceneRun(run)
  if (restoreBase && runtimeHandle.pageExit === combinedMotionPageExit) {
    runtimeHandle.pageExit = baseMotionPageExit
  }
  if (restoreBase && runtimeHandle.dispose === combinedMotionDispose) {
    runtimeHandle.dispose = baseMotionDispose
  }
  if (motionSceneGlobal.__OPENPENCIL_MOTION_SCENE_RUNTIME__ === motionSceneRuntimeHandle) {
    delete motionSceneGlobal.__OPENPENCIL_MOTION_SCENE_RUNTIME__
  }
}

function combinedMotionDispose(): void {
  disposeMotionSceneRuntime(false)
  baseMotionDispose()
}

const motionSceneRuntimeHandle: OpenPencilMotionSceneRuntimeHandle = {
  dispose: disposeMotionSceneRuntime,
  inspect: inspectMotionScenes,
  pageExit: runMotionScenePageExit,
  play: playMotionScene,
  stop: stopMotionScene
}
runtimeHandle.pageExit = combinedMotionPageExit
runtimeHandle.dispose = combinedMotionDispose
motionSceneGlobal.__OPENPENCIL_MOTION_SCENE_RUNTIME__ = motionSceneRuntimeHandle
hot?.dispose(disposeMotionSceneRuntime)
`
}

function collectMotionSceneEntries(
  irs: readonly IRTree[],
  components: readonly ComponentDef[]
): ReactMotionSceneEntry[] {
  const entries = new Map<string, ReactMotionSceneEntry>()
  const add = (ownerId: string, scene: IRMotionScene): void => {
    if (!entries.has(ownerId)) entries.set(ownerId, { ownerId, scene })
  }
  const visit = (node: IRNode): void => {
    if (node.kind === 'element') {
      if (node.motionScene) add(node.sourceId, node.motionScene)
      node.children.forEach(visit)
    } else if (node.kind === 'conditional') visit(node.consequent)
    else if (node.kind === 'list') visit(node.template)
  }
  for (const ir of irs) {
    if (ir.motionScene) add(ir.pageId, ir.motionScene)
    ir.children.forEach(visit)
  }
  for (const component of components) {
    component.children.forEach(visit)
    for (const variant of component.variants ?? []) variant.children.forEach(visit)
  }
  return [...entries.values()].sort((left, right) => left.ownerId.localeCompare(right.ownerId))
}
