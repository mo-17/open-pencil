import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  FIGMA_NATIVE_MOTION_OWNERSHIP_KEY,
  FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
  createFigmaNativeMotionApplyRequest,
  encodeFigmaMotionSharedClearEnvelope,
  encodeFigmaMotionSharedEnvelope,
  importFigmaNativeMotion,
  inspectFigmaNativeMotion,
  type FigmaNativeMotionApplyRequest,
  type FigmaNativeMotionConflictPolicy,
  type FigmaNativeMotionDiagnostic,
  type FigmaNativeMotionDiff,
  type FigmaNativeMotionFieldName,
  type FigmaNativeMotionImportResult,
  type FigmaNativeMotionInspection,
  type FigmaNativeMotionPlan,
  type FigmaNativeMotionSnapshot
} from '@open-pencil/fig'
import type { SceneNode } from '@open-pencil/scene-graph'

import { dim, fail, fmtList, ok } from '#cli/format'
import { loadDocument, populateWholeDocument } from '#cli/headless'

const MAX_SNAPSHOT_BYTES = 1_000_000
const EMIT_MODES = new Set<NativeMotionEmitMode>(['plan', 'script', 'snapshot'])
const CONFLICT_POLICIES = new Set<FigmaNativeMotionConflictPolicy>(['replace-owned', 'replace-all'])

export const FIGMA_NATIVE_MOTION_APPLY_SNAPSHOT_SCHEMA =
  'openpencil.figma-native-motion-apply' as const
export const FIGMA_NATIVE_MOTION_CLEAR_SNAPSHOT_SCHEMA =
  'openpencil.figma-native-motion-clear' as const

export type NativeMotionEmitMode = 'plan' | 'script' | 'snapshot'

export interface NativeMotionSnapshotFile {
  file: string
  value: FigmaNativeMotionSnapshot
  inspection: FigmaNativeMotionInspection
  imported: FigmaNativeMotionImportResult
}

export interface NativeMotionSourceNode {
  file: string
  node: Pick<SceneNode, 'id' | 'name' | 'type' | 'motion' | 'opacity'>
}

export interface FigmaNativeMotionApplySnapshot {
  schema: typeof FIGMA_NATIVE_MOTION_APPLY_SNAPSHOT_SCHEMA
  version: 1
  generatedOnly: true
  target: { mode: 'selection' } | { mode: 'node-id'; nodeId: string }
  sharedMotionRaw: string
  request: FigmaNativeMotionApplyRequest
}

export interface FigmaNativeMotionClearSnapshot {
  schema: typeof FIGMA_NATIVE_MOTION_CLEAR_SNAPSHOT_SCHEMA
  version: 1
  generatedOnly: true
  compareOnly: true
  sharedMotionRaw: string
  ownership: {
    namespace: typeof FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE
    key: typeof FIGMA_NATIVE_MOTION_OWNERSHIP_KEY
    expectedRaw: string
  }
  nativeAction: 'remove-verified-owned' | 'preserve-unverified'
  removeOwnedFields: FigmaNativeMotionFieldName[]
  preserveAnimationStyles: true
  preserveTimelines: true
}

export async function readNativeMotionSnapshot(file: string): Promise<NativeMotionSnapshotFile> {
  const resolved = resolve(file)
  const fileStats = await stat(resolved)
  if (!fileStats.isFile()) throw new Error('Native Motion snapshot must be a regular JSON file')
  if (fileStats.size > MAX_SNAPSHOT_BYTES) {
    throw new Error('Native Motion snapshot exceeds the 1 MB safety limit')
  }
  const raw = await readFile(resolved, 'utf8')
  if (Buffer.byteLength(raw, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error('Native Motion snapshot exceeds the 1 MB safety limit')
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error('Native Motion snapshot is not valid JSON: ' + messageOf(error))
  }
  const inspection = inspectFigmaNativeMotion(value)
  const imported = importFigmaNativeMotion(value)
  return {
    file: resolved,
    value: value as FigmaNativeMotionSnapshot,
    inspection,
    imported
  }
}

export async function loadNativeMotionSource(
  file: string,
  nodeId: string
): Promise<NativeMotionSourceNode> {
  const resolved = resolve(file)
  const graph = await loadDocument(resolved)
  populateWholeDocument(graph)
  const node = graph.getNode(nodeId)
  if (!node) throw new Error('Node "' + nodeId + '" not found')
  return {
    file: resolved,
    node: {
      id: node.id,
      name: node.name,
      type: node.type,
      motion: node.motion,
      opacity: node.opacity
    }
  }
}

export function nativeMotionEmitMode(value: string): NativeMotionEmitMode {
  if (EMIT_MODES.has(value as NativeMotionEmitMode)) return value as NativeMotionEmitMode
  throw new Error('Unknown emit mode "' + value + '". Expected plan, script, or snapshot.')
}

export function nativeMotionConflictPolicy(value: string): FigmaNativeMotionConflictPolicy {
  if (CONFLICT_POLICIES.has(value as FigmaNativeMotionConflictPolicy)) {
    return value as FigmaNativeMotionConflictPolicy
  }
  throw new Error('Unknown conflict policy "' + value + '". Expected replace-owned or replace-all.')
}

export function createNativeMotionApplySnapshot(
  plan: FigmaNativeMotionPlan,
  motion: SceneNode['motion'],
  input: {
    targetNodeId?: string
    conflictPolicy: FigmaNativeMotionConflictPolicy
    allowTimelineGrowth: boolean
  }
): FigmaNativeMotionApplySnapshot {
  if (!motion) throw new Error('Cannot snapshot an empty MotionSpec')
  return {
    schema: FIGMA_NATIVE_MOTION_APPLY_SNAPSHOT_SCHEMA,
    version: 1,
    generatedOnly: true,
    target: input.targetNodeId
      ? { mode: 'node-id', nodeId: input.targetNodeId }
      : { mode: 'selection' },
    sharedMotionRaw: encodeFigmaMotionSharedEnvelope(motion),
    request: createFigmaNativeMotionApplyRequest(plan, {
      conflictPolicy: input.conflictPolicy,
      allowTimelineGrowth: input.allowTimelineGrowth
    })
  }
}

export function createNativeMotionClearSnapshot(
  current: NativeMotionSnapshotFile | null
): FigmaNativeMotionClearSnapshot {
  const verifiedOwned = current?.inspection.ownership === 'valid'
  return {
    schema: FIGMA_NATIVE_MOTION_CLEAR_SNAPSHOT_SCHEMA,
    version: 1,
    generatedOnly: true,
    compareOnly: true,
    sharedMotionRaw: encodeFigmaMotionSharedClearEnvelope(),
    ownership: {
      namespace: FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
      key: FIGMA_NATIVE_MOTION_OWNERSHIP_KEY,
      expectedRaw: verifiedOwned ? current.value.ownershipRaw : ''
    },
    nativeAction: verifiedOwned ? 'remove-verified-owned' : 'preserve-unverified',
    removeOwnedFields: verifiedOwned ? [...current.inspection.fields] : [],
    preserveAnimationStyles: true,
    preserveTimelines: true
  }
}

export function printNativeMotionDiagnostics(
  diagnostics: readonly FigmaNativeMotionDiagnostic[]
): void {
  if (diagnostics.length === 0) return
  console.log('')
  console.log(
    fmtList(
      diagnostics.map((entry) => ({
        header: entry.severity === 'error' ? fail(entry.code) : dim(entry.code),
        details: {
          message: entry.message,
          ...(entry.path ? { path: entry.path } : {})
        }
      })),
      { numbered: false }
    )
  )
}

export function printNativeMotionComparison(diff: FigmaNativeMotionDiff | null): void {
  if (!diff) return
  console.log('')
  console.log(
    fmtList(
      [
        {
          header: diff.supported ? ok('compare-only') : fail('compare-blocked'),
          details: {
            add: fieldList(diff.addFields),
            update: fieldList(diff.updateFields),
            remove: fieldList(diff.removeFields),
            timeline: diff.timelineGrowth.change,
            ownership: diff.ownershipChange
          }
        }
      ],
      { compact: true }
    )
  )
  printNativeMotionDiagnostics(diff.diagnostics)
}

export function fieldList(fields: readonly string[]): string {
  return fields.length > 0 ? fields.join(', ') : 'none'
}

export function outputPath(value: string | undefined): string | null {
  return value ? resolve(value) : null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
