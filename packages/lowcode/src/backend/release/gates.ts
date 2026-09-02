import type { BackendDiagnostic, BackendValidationResult } from '../types'
import type {
  BackendProductionGateBlocker,
  BackendProductionGateId,
  BackendProductionGateResultV1,
  BackendProductionReadiness,
  FrontendDeploymentAssessment,
  FrontendDeploymentFacts
} from './types'
import { BACKEND_PRODUCTION_GATE_IDS } from './types'
import {
  exactArray,
  exactRecord,
  nullableDigest,
  nullableTimestamp,
  releaseDigest,
  releaseTimestamp
} from './validation'

const GATE_IDS = new Set<string>(BACKEND_PRODUCTION_GATE_IDS)
const GATE_STATUSES = new Set(['passed', 'unknown', 'failed'])

function unknownGate(gate: BackendProductionGateId): BackendProductionGateResultV1 {
  return { gate, status: 'unknown', checkedAt: null, evidenceDigest: null }
}

function failedGate(gate: BackendProductionGateId): BackendProductionGateResultV1 {
  return { gate, status: 'failed', checkedAt: null, evidenceDigest: null }
}

function trustworthyGate(
  result: BackendProductionGateResultV1,
  verifiedAt: string | null
): BackendProductionGateResultV1 {
  if (result.status !== 'passed') return result
  if (!verifiedAt || !result.checkedAt || !result.evidenceDigest) return unknownGate(result.gate)
  try {
    const checkedAt = releaseTimestamp(result.checkedAt, `gate.${result.gate}.checkedAt`)
    if (Date.parse(checkedAt) > Date.parse(verifiedAt)) return unknownGate(result.gate)
    return {
      gate: result.gate,
      status: 'passed',
      checkedAt,
      evidenceDigest: releaseDigest(result.evidenceDigest, `gate.${result.gate}.evidenceDigest`)
    }
  } catch {
    return unknownGate(result.gate)
  }
}

function parsedGate(value: unknown, index: number, path: string): BackendProductionGateResultV1 {
  const gatePath = `${path}[${index}]`
  const source = exactRecord(value, gatePath, ['gate', 'status', 'checkedAt', 'evidenceDigest'])
  if (typeof source.gate !== 'string' || !GATE_IDS.has(source.gate)) {
    throw new TypeError(`${gatePath}.gate is not supported`)
  }
  if (typeof source.status !== 'string' || !GATE_STATUSES.has(source.status)) {
    throw new TypeError(`${gatePath}.status is not supported`)
  }
  const checkedAt = nullableTimestamp(source.checkedAt, `${gatePath}.checkedAt`)
  const evidenceDigest = nullableDigest(source.evidenceDigest, `${gatePath}.evidenceDigest`)
  if (source.status === 'passed' && (!checkedAt || !evidenceDigest)) {
    throw new TypeError(`${gatePath} passed gates require timestamped digest evidence`)
  }
  return {
    gate: source.gate as BackendProductionGateId,
    status: source.status as BackendProductionGateResultV1['status'],
    checkedAt,
    evidenceDigest
  }
}

export function parseBackendProductionGateResults(
  value: unknown,
  path = '$.gates'
): BackendProductionGateResultV1[] {
  const entries = exactArray(value, path, BACKEND_PRODUCTION_GATE_IDS.length)
  if (entries.length > BACKEND_PRODUCTION_GATE_IDS.length) {
    throw new TypeError(`${path} exceeds the strict production gate count`)
  }
  return entries.map((entry, index) => parsedGate(entry, index, path))
}

export function validateBackendProductionGateResults(
  value: unknown
): BackendValidationResult<BackendProductionGateResultV1[]> {
  try {
    return { ok: true, value: parseBackendProductionGateResults(value), diagnostics: [] }
  } catch (cause) {
    const diagnostic: BackendDiagnostic = {
      code: 'backend-production-gates-invalid',
      severity: 'error',
      path: '$.gates',
      message: cause instanceof Error ? cause.message : 'Production gates are invalid.'
    }
    return { ok: false, diagnostics: [diagnostic] }
  }
}

export function evaluateProductionReleaseGates(
  results: readonly BackendProductionGateResultV1[],
  verifiedAt: string | null
): BackendProductionReadiness {
  const verificationBoundary =
    verifiedAt === null ? null : releaseTimestamp(verifiedAt, 'productionGates.verifiedAt')
  const known = new Set<string>(BACKEND_PRODUCTION_GATE_IDS)
  const grouped = new Map<BackendProductionGateId, BackendProductionGateResultV1[]>()
  for (const result of results) {
    if (!known.has(result.gate)) {
      throw new TypeError(`Unsupported production release gate: ${String(result.gate)}`)
    }
    const entries = grouped.get(result.gate) ?? []
    entries.push(result)
    grouped.set(result.gate, entries)
  }
  const gates = BACKEND_PRODUCTION_GATE_IDS.map((gate) => {
    const entries = grouped.get(gate) ?? []
    if (entries.length === 0) return unknownGate(gate)
    if (entries.length > 1) return failedGate(gate)
    return trustworthyGate(entries[0], verificationBoundary)
  })
  const blockers: BackendProductionGateBlocker[] = gates
    .filter(
      (gate): gate is BackendProductionGateResultV1 & { status: 'unknown' | 'failed' } =>
        gate.status !== 'passed'
    )
    .map((gate) => ({
      gate: gate.gate,
      status: gate.status,
      code: gate.status === 'failed' ? 'production-gate-failed' : 'production-gate-unknown',
      message:
        gate.status === 'failed'
          ? `Production gate ${gate.gate} failed.`
          : `Production gate ${gate.gate} is missing, future-dated, or unknown.`
    }))
  return { releaseReady: blockers.length === 0, gates, blockers }
}

export function assessFrontendDeployment(
  facts: FrontendDeploymentFacts
): FrontendDeploymentAssessment {
  const backendDeploymentRequired = facts.backendRequired && !facts.backendDeployed
  return {
    frontendHostingProvider: facts.frontendHostingProvider,
    backendProvider: facts.backendProvider,
    frontendDeployed: facts.frontendDeployed,
    backendDeploymentRequired,
    applicationReleaseComplete: facts.frontendDeployed && !backendDeploymentRequired
  }
}
