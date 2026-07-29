import {
  FIGMA_MOTION_SHARED_KEY,
  FIGMA_MOTION_SHARED_NAMESPACE,
  createFigmaNativeMotionPlan,
  decodeFigmaMotionSharedPayload,
  type FigmaNativeMotionPlan,
  type FigmaNativeMotionTransactionTarget,
  type FigmaNativeMotionTransactionResult
} from '@open-pencil/fig'

import {
  applyFigmaNativeMotionTransaction,
  createFigmaNativeMotionApplyRequest
} from './transaction'
import type {
  FigmaMotionAdapterCounts,
  FigmaMotionAdapterSummary,
  FigmaMotionNodeResult,
  FigmaMotionSelectionHost,
  FigmaMotionTarget
} from './types'

export function runFigmaMotionAdapter(host: FigmaMotionSelectionHost): FigmaMotionAdapterSummary {
  const results = host.currentPage.selection.map((target) => processTarget(host, target))
  return {
    schema: 'openpencil.figma-motion-adapter-result',
    version: 1,
    conflictPolicy: 'replace-owned',
    selectionCount: host.currentPage.selection.length,
    counts: countResults(results),
    results
  }
}

function processTarget(
  host: FigmaMotionSelectionHost,
  target: FigmaMotionTarget
): FigmaMotionNodeResult {
  try {
    const raw = target.getSharedPluginData(FIGMA_MOTION_SHARED_NAMESPACE, FIGMA_MOTION_SHARED_KEY)
    if (raw === '') {
      return simpleResult(target, 'skipped', 'no-shared-motion', 'No OpenPencil Motion envelope')
    }
    const decoded = decodeFigmaMotionSharedPayload(raw)
    if (!decoded.ok) {
      return simpleResult(target, 'failed', 'invalid-envelope', decoded.error)
    }
    if (decoded.value.kind === 'cleared') {
      return simpleResult(
        target,
        'skipped',
        'motion-cleared',
        'OpenPencil Motion was explicitly cleared; this tombstone does not authorize deleting existing native Figma Motion tracks'
      )
    }
    const plan = createFigmaNativeMotionPlan(decoded.value.value.motion, {
      nodeOpacity: typeof target.opacity === 'number' ? target.opacity : 1
    })
    if (!plan.supported) {
      return {
        ...simpleResult(
          target,
          'unsupported',
          'unsupported-motion',
          'The MotionSpec is outside the verified Figma Motion API subset'
        ),
        issues: [...plan.issues],
        warnings: [...plan.warnings]
      }
    }
    const request = createFigmaNativeMotionApplyRequest(plan, {
      conflictPolicy: 'replace-owned',
      allowTimelineGrowth: false
    })
    return transactionResult(
      target,
      plan,
      applyFigmaNativeMotionTransaction(host, adaptTransactionTarget(target), request)
    )
  } catch (error) {
    return simpleResult(target, 'failed', 'scan-failed', messageOf(error))
  }
}

function adaptTransactionTarget(target: FigmaMotionTarget): FigmaNativeMotionTransactionTarget {
  return {
    get id() {
      return target.id
    },
    get animationStyles() {
      return target.animationStyles
    },
    get manualKeyframeTracks() {
      return target.manualKeyframeTracks
    },
    get timelines() {
      return target.timelines
    },
    getSharedPluginData(namespace, key) {
      return target.getSharedPluginData(namespace, key)
    },
    setSharedPluginData(namespace, key, value) {
      target.setSharedPluginData(namespace, key, value)
    },
    applyManualKeyframeTrack(field, track) {
      target.applyManualKeyframeTrack(toFigmaPropertyField(field), track)
    },
    removeManualKeyframeTrack(field) {
      target.removeManualKeyframeTrack(toFigmaPropertyField(field))
    },
    setTimelineDuration(id, duration) {
      target.setTimelineDuration(id, duration)
    }
  }
}

function toFigmaPropertyField(field: {
  type: 'PROPERTY'
  name: string
}): Extract<KeyframeField, { type: 'PROPERTY' }> {
  switch (field.name) {
    case 'OPACITY':
    case 'TRANSLATION_X':
    case 'TRANSLATION_Y':
    case 'ROTATION':
    case 'SCALE_X':
    case 'SCALE_Y':
      return { type: 'PROPERTY', name: field.name }
    default:
      throw new TypeError(`Unsupported OpenPencil Motion property field: ${field.name}`)
  }
}

function transactionResult(
  target: FigmaMotionTarget,
  plan: FigmaNativeMotionPlan,
  result: FigmaNativeMotionTransactionResult
): FigmaMotionNodeResult {
  return {
    nodeId: result.nodeId ?? target.id,
    nodeName: target.name,
    status: result.status,
    code: result.code,
    message: result.message,
    rolledBack: result.rolledBack,
    timelineId: result.timelineId,
    durationSeconds: result.durationSeconds,
    managedFields: [...result.managedFields],
    issues: [...plan.issues],
    warnings: [...plan.warnings]
  }
}

function simpleResult(
  target: FigmaMotionTarget,
  status: FigmaMotionNodeResult['status'],
  code: string,
  message: string
): FigmaMotionNodeResult {
  return {
    nodeId: target.id,
    nodeName: target.name,
    status,
    code,
    message,
    rolledBack: false,
    timelineId: null,
    durationSeconds: null,
    managedFields: [],
    issues: [],
    warnings: []
  }
}

function countResults(results: FigmaMotionNodeResult[]): FigmaMotionAdapterCounts {
  const counts: FigmaMotionAdapterCounts = {
    applied: 0,
    unchanged: 0,
    skipped: 0,
    unsupported: 0,
    conflict: 0,
    failed: 0
  }
  for (const result of results) counts[result.status]++
  return counts
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
