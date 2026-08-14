import {
  adoptDetachedGraphSnapshot,
  graphFromDetachedSnapshot,
  snapshotDetachedGraph,
  type DetachedGraphSnapshot
} from './graph'
import {
  AI_VISUAL_COMPARE_VIEWPORTS,
  type AIShadowDiagnostic,
  type AIShadowVisualComparisonResult,
  type AIVisualArtifact,
  type AIVisualComparisonBudget,
  type AIVisualComparisonRound,
  type AIVisualReference,
  type AIVisualViewport,
  type AIVisualViewportComparison,
  type RunAIShadowVisualComparisonOptions
} from './types'

const HARD_MAX_REPAIR_ROUNDS = 2
const DIAGNOSTIC_MESSAGE_LIMIT = 500

export const DEFAULT_AI_VISUAL_COMPARISON_BUDGET: Readonly<AIVisualComparisonBudget> =
  Object.freeze({
    maxRepairRounds: 2,
    maxTotalPixels: 12_000_000,
    maxArtifactBytes: 8 * 1024 * 1024,
    maxTotalArtifactBytes: 32 * 1024 * 1024,
    maxDurationMs: 60_000,
    maxDiagnostics: 100,
    differenceThreshold: 0.05
  })

function boundedInteger(value: number, path: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${path} must be a safe integer of at least ${minimum}`)
  }
  return value
}

export function resolveAIVisualComparisonBudget(
  value: Partial<AIVisualComparisonBudget> = {}
): Readonly<AIVisualComparisonBudget> {
  const maxRepairRounds = boundedInteger(
    value.maxRepairRounds ?? DEFAULT_AI_VISUAL_COMPARISON_BUDGET.maxRepairRounds,
    'budget.maxRepairRounds',
    0
  )
  if (maxRepairRounds > HARD_MAX_REPAIR_ROUNDS) {
    throw new RangeError(`budget.maxRepairRounds may not exceed ${HARD_MAX_REPAIR_ROUNDS}`)
  }
  const differenceThreshold =
    value.differenceThreshold ?? DEFAULT_AI_VISUAL_COMPARISON_BUDGET.differenceThreshold
  if (!Number.isFinite(differenceThreshold) || differenceThreshold < 0 || differenceThreshold > 1) {
    throw new TypeError('budget.differenceThreshold must be between zero and one')
  }
  return Object.freeze({
    maxRepairRounds,
    maxTotalPixels: boundedInteger(
      value.maxTotalPixels ?? DEFAULT_AI_VISUAL_COMPARISON_BUDGET.maxTotalPixels,
      'budget.maxTotalPixels'
    ),
    maxArtifactBytes: boundedInteger(
      value.maxArtifactBytes ?? DEFAULT_AI_VISUAL_COMPARISON_BUDGET.maxArtifactBytes,
      'budget.maxArtifactBytes'
    ),
    maxTotalArtifactBytes: boundedInteger(
      value.maxTotalArtifactBytes ?? DEFAULT_AI_VISUAL_COMPARISON_BUDGET.maxTotalArtifactBytes,
      'budget.maxTotalArtifactBytes'
    ),
    maxDurationMs: boundedInteger(
      value.maxDurationMs ?? DEFAULT_AI_VISUAL_COMPARISON_BUDGET.maxDurationMs,
      'budget.maxDurationMs'
    ),
    maxDiagnostics: boundedInteger(
      value.maxDiagnostics ?? DEFAULT_AI_VISUAL_COMPARISON_BUDGET.maxDiagnostics,
      'budget.maxDiagnostics'
    ),
    differenceThreshold
  })
}

class ComparisonStopError extends Error {
  constructor(
    readonly status: AIShadowVisualComparisonResult['status'],
    readonly diagnostic: AIShadowDiagnostic
  ) {
    super(diagnostic.message)
    this.name = 'ComparisonStopError'
  }
}

function message(error: unknown, fallback: string): string {
  const value = error instanceof Error ? error.message : fallback
  return value.slice(0, DIAGNOSTIC_MESSAGE_LIMIT)
}

function stop(
  status: ComparisonStopError['status'],
  code: AIShadowDiagnostic['code'],
  text: string,
  context: { round?: number; viewport?: AIVisualViewport } = {}
): never {
  throw new ComparisonStopError(status, {
    code,
    message: text.slice(0, DIAGNOSTIC_MESSAGE_LIMIT),
    severity: 'error',
    ...(context.round === undefined ? {} : { round: context.round }),
    ...(context.viewport ? { viewportId: context.viewport.id } : {})
  })
}

function assertArtifact(
  value: unknown,
  viewport: AIVisualViewport,
  budget: Readonly<AIVisualComparisonBudget>,
  round?: number
): AIVisualArtifact {
  if (!value || typeof value !== 'object') {
    stop('failed', 'invalid-artifact', 'Visual capture returned no artifact.', {
      round,
      viewport
    })
  }
  const artifact = value as Partial<AIVisualArtifact>
  if (
    (artifact.mediaType !== 'image/png' && artifact.mediaType !== 'image/webp') ||
    !(artifact.bytes instanceof Uint8Array) ||
    artifact.bytes.byteLength === 0 ||
    artifact.width !== viewport.width ||
    artifact.height !== viewport.height
  ) {
    stop('failed', 'invalid-artifact', 'Visual artifact metadata does not match its viewport.', {
      round,
      viewport
    })
  }
  if (artifact.bytes.byteLength > budget.maxArtifactBytes) {
    stop(
      'budget-exhausted',
      'artifact-budget-exceeded',
      `Visual artifact exceeds the per-artifact limit of ${budget.maxArtifactBytes} bytes.`,
      { round, viewport }
    )
  }
  return Object.freeze({
    mediaType: artifact.mediaType,
    bytes: artifact.bytes.slice(),
    width: artifact.width,
    height: artifact.height
  })
}

function referenceMap(
  references: readonly AIVisualReference[],
  budget: Readonly<AIVisualComparisonBudget>
): Map<AIVisualViewport['id'], AIVisualArtifact> {
  const result = new Map<AIVisualViewport['id'], AIVisualArtifact>()
  for (const reference of references) {
    const viewport = AI_VISUAL_COMPARE_VIEWPORTS.find(({ id }) => id === reference.viewportId)
    if (!viewport || result.has(reference.viewportId)) {
      stop(
        'failed',
        'invalid-input',
        'References must contain each supported viewport exactly once.'
      )
    }
    result.set(reference.viewportId, assertArtifact(reference.artifact, viewport, budget))
  }
  if (result.size !== AI_VISUAL_COMPARE_VIEWPORTS.length) {
    stop(
      'failed',
      'invalid-input',
      'References must contain mobile, tablet, and desktop artifacts.'
    )
  }
  return result
}

function requireReference(
  references: ReadonlyMap<AIVisualViewport['id'], AIVisualArtifact>,
  viewport: AIVisualViewport
): AIVisualArtifact {
  const reference = references.get(viewport.id)
  if (!reference) stop('failed', 'invalid-input', `Missing ${viewport.id} visual reference.`)
  return reference
}

function copyArtifact(artifact: AIVisualArtifact): AIVisualArtifact {
  return {
    mediaType: artifact.mediaType,
    bytes: artifact.bytes.slice(),
    width: artifact.width,
    height: artifact.height
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Aborted')
}

function combinedSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number
): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const abort = () => controller.abort(parent?.reason)
  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error('Visual comparison time budget exceeded')),
    timeoutMs
  )
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
    }
  }
}

async function boundedCall<T>(
  callback: (signal: AbortSignal) => Promise<T> | T,
  parentSignal: AbortSignal | undefined,
  remainingMs: number
): Promise<T> {
  if (parentSignal?.aborted) stop('aborted', 'aborted', 'Visual comparison was cancelled.')
  if (remainingMs <= 0) {
    stop('budget-exhausted', 'duration-budget-exceeded', 'Visual comparison time budget expired.')
  }
  const combined = combinedSignal(parentSignal, remainingMs)
  const startedAt = Date.now()
  try {
    const result = await Promise.race([
      Promise.resolve(callback(combined.signal)),
      new Promise<never>((_, reject) => {
        combined.signal.addEventListener('abort', () => reject(abortError(combined.signal)), {
          once: true
        })
      })
    ])
    if (Date.now() - startedAt > remainingMs) {
      stop('budget-exhausted', 'duration-budget-exceeded', 'Visual comparison time budget expired.')
    }
    return result
  } catch (error) {
    if (parentSignal?.aborted) stop('aborted', 'aborted', 'Visual comparison was cancelled.')
    if (combined.signal.aborted) {
      stop('budget-exhausted', 'duration-budget-exceeded', 'Visual comparison time budget expired.')
    }
    throw error
  } finally {
    combined.dispose()
  }
}

class VisualComparisonRun {
  readonly startedAt = Date.now()
  readonly rounds: AIVisualComparisonRound[] = []
  readonly diagnostics: AIShadowDiagnostic[] = []
  repairRounds = 0
  totalPixels = 0
  totalArtifactBytes = 0

  constructor(
    readonly options: RunAIShadowVisualComparisonOptions,
    readonly budget: Readonly<AIVisualComparisonBudget>
  ) {}

  finish(status: AIShadowVisualComparisonResult['status']): AIShadowVisualComparisonResult {
    return {
      status,
      rounds: this.rounds,
      repairRounds: this.repairRounds,
      totalPixels: this.totalPixels,
      totalArtifactBytes: this.totalArtifactBytes,
      elapsedMs: Date.now() - this.startedAt,
      diagnostics: this.diagnostics
    }
  }

  append(value: AIShadowDiagnostic): void {
    if (this.diagnostics.length < this.budget.maxDiagnostics) {
      this.diagnostics.push(value)
      return
    }
    this.diagnostics[this.diagnostics.length - 1] = {
      code: 'diagnostic-budget-exceeded',
      message: `Visual comparison diagnostics were capped at ${this.budget.maxDiagnostics}.`,
      severity: 'warning'
    }
  }

  addArtifact(
    viewport: AIVisualViewport,
    artifact: AIVisualArtifact,
    phase: string,
    round?: number
  ): void {
    const pixels = viewport.width * viewport.height
    if (this.totalPixels + pixels > this.budget.maxTotalPixels) {
      stop(
        'budget-exhausted',
        'pixel-budget-exceeded',
        `${phase} pixels exceed the total budget.`,
        { round, viewport }
      )
    }
    if (this.totalArtifactBytes + artifact.bytes.byteLength > this.budget.maxTotalArtifactBytes) {
      stop(
        'budget-exhausted',
        'artifact-budget-exceeded',
        `${phase} artifacts exceed the total byte budget.`,
        { round, viewport }
      )
    }
    this.totalPixels += pixels
    this.totalArtifactBytes += artifact.bytes.byteLength
  }

  remainingMs(): number {
    return this.budget.maxDurationMs - (Date.now() - this.startedAt)
  }

  async compareViewport(
    references: ReadonlyMap<AIVisualViewport['id'], AIVisualArtifact>,
    roundSnapshot: DetachedGraphSnapshot,
    viewport: AIVisualViewport,
    round: number
  ): Promise<AIVisualViewportComparison> {
    let captured: unknown
    try {
      const captureGraph = graphFromDetachedSnapshot(roundSnapshot)
      captured = await boundedCall(
        (signal) =>
          this.options.captureBackend.capture({
            graph: captureGraph,
            pageId: this.options.workspace.pageId,
            viewport,
            round,
            signal
          }),
        this.options.signal,
        this.remainingMs()
      )
    } catch (error) {
      if (error instanceof ComparisonStopError) throw error
      stop('failed', 'capture-failed', message(error, 'Visual capture failed.'), {
        round,
        viewport
      })
    }
    const candidate = assertArtifact(captured, viewport, this.budget, round)
    this.addArtifact(viewport, candidate, 'Candidate', round)
    const reference = requireReference(references, viewport)

    let differenceRatio: number
    try {
      const value = await boundedCall(
        (signal) =>
          this.options.comparator.compare({
            reference: copyArtifact(reference),
            candidate: copyArtifact(candidate),
            viewport,
            round,
            signal
          }),
        this.options.signal,
        this.remainingMs()
      )
      differenceRatio = value.differenceRatio
    } catch (error) {
      if (error instanceof ComparisonStopError) throw error
      stop('failed', 'compare-failed', message(error, 'Visual comparison failed.'), {
        round,
        viewport
      })
    }
    if (!Number.isFinite(differenceRatio) || differenceRatio < 0 || differenceRatio > 1) {
      stop('failed', 'compare-failed', 'Comparator differenceRatio must be between zero and one.', {
        round,
        viewport
      })
    }
    return Object.freeze({
      viewport,
      reference,
      candidate,
      differenceRatio,
      passed: differenceRatio <= this.budget.differenceThreshold
    })
  }

  async compareRound(
    references: ReadonlyMap<AIVisualViewport['id'], AIVisualArtifact>,
    round: number
  ): Promise<AIVisualComparisonRound> {
    const comparisons: AIVisualViewportComparison[] = []
    const roundSnapshot = snapshotDetachedGraph(
      this.options.workspace.graph,
      this.options.workspace.limits
    )
    for (const viewport of AI_VISUAL_COMPARE_VIEWPORTS) {
      comparisons.push(await this.compareViewport(references, roundSnapshot, viewport, round))
    }
    const value = Object.freeze({
      round,
      comparisons,
      passed: comparisons.every((comparison) => comparison.passed)
    })
    this.rounds.push(value)
    return value
  }

  async repair(round: number, comparisons: readonly AIVisualViewportComparison[]): Promise<void> {
    const repair = this.options.repair
    if (!repair) return
    const stagedSnapshot = snapshotDetachedGraph(
      this.options.workspace.graph,
      this.options.workspace.limits
    )
    const stagedGraph = graphFromDetachedSnapshot(stagedSnapshot)
    try {
      await boundedCall(
        (signal) =>
          repair({
            graph: stagedGraph,
            pageId: this.options.workspace.pageId,
            round,
            comparisons,
            signal
          }),
        this.options.signal,
        this.remainingMs()
      )
      adoptDetachedGraphSnapshot(
        this.options.workspace.graph,
        snapshotDetachedGraph(stagedGraph, this.options.workspace.limits)
      )
      this.repairRounds++
    } catch (error) {
      if (error instanceof ComparisonStopError) throw error
      stop('failed', 'repair-failed', message(error, 'Visual repair failed.'), { round })
    }
  }

  async execute(): Promise<AIShadowVisualComparisonResult> {
    try {
      if (this.options.signal?.aborted) {
        stop('aborted', 'aborted', 'Visual comparison was cancelled.')
      }
      const references = referenceMap(this.options.references, this.budget)
      for (const viewport of AI_VISUAL_COMPARE_VIEWPORTS) {
        this.addArtifact(viewport, requireReference(references, viewport), 'Reference')
      }

      for (let round = 0; round <= this.budget.maxRepairRounds; round++) {
        const result = await this.compareRound(references, round)
        if (result.passed) return this.finish('passed')
        if (round === this.budget.maxRepairRounds || !this.options.repair) {
          this.append({
            code: this.options.repair ? 'repair-limit-reached' : 'threshold-not-met',
            message: this.options.repair
              ? `Visual comparison stopped after ${this.budget.maxRepairRounds} repair rounds.`
              : 'Visual comparison did not meet the configured threshold.',
            severity: 'warning',
            round
          })
          return this.finish('not-passed')
        }
        await this.repair(round + 1, result.comparisons)
      }
    } catch (error) {
      if (error instanceof ComparisonStopError) {
        this.append(error.diagnostic)
        return this.finish(error.status)
      }
      this.append({
        code: 'invalid-input',
        message: message(error, 'Visual comparison failed.'),
        severity: 'error'
      })
      return this.finish('failed')
    }
    return this.finish('not-passed')
  }
}

export async function runAIShadowVisualComparison(
  options: RunAIShadowVisualComparisonOptions
): Promise<AIShadowVisualComparisonResult> {
  let budget: Readonly<AIVisualComparisonBudget>
  try {
    budget = resolveAIVisualComparisonBudget(options.budget)
  } catch (error) {
    return {
      status: 'failed',
      rounds: [],
      repairRounds: 0,
      totalPixels: 0,
      totalArtifactBytes: 0,
      elapsedMs: 0,
      diagnostics: [
        {
          code: 'invalid-input',
          message: message(error, 'Invalid visual comparison budget.'),
          severity: 'error'
        }
      ]
    }
  }
  return new VisualComparisonRun(options, budget).execute()
}
