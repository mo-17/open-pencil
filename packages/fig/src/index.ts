export {
  compressFigDataSync,
  parseFigBuffer,
  writeFigArchive,
  type FigImageEntry,
  type FigParseResult,
  type WriteFigArchiveInput
} from './archive'
export {
  effectiveFigmaRawNodeFields,
  effectiveFigmaSourcePayload,
  readEffectiveFigmaRawField,
  staleFigmaRawFields
} from './source-metadata'
export {
  FIGMA_MOTION_API_REVISION,
  FIGMA_MOTION_SHARED_KEY,
  FIGMA_MOTION_SHARED_NAMESPACE,
  FIGMA_NATIVE_MOTION_APPLICATOR_SCHEMA,
  FIGMA_NATIVE_MOTION_FIELDS,
  FIGMA_NATIVE_MOTION_OWNERSHIP_KEY,
  FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
  applyFigmaNativeMotionTransaction,
  buildFigmaMotionPluginScript,
  createFigmaNativeMotionApplyRequest,
  createFigmaNativeMotionPlan,
  decodeFigmaMotionSharedEnvelope,
  decodeFigmaMotionSharedPayload,
  diffFigmaNativeMotion,
  encodeFigmaMotionSharedClearEnvelope,
  encodeFigmaMotionSharedEnvelope,
  getFigmaNativeMotionTransactionSource,
  importFigmaNativeMotion,
  inspectFigmaNativeMotion,
  type FigmaMotionSharedClearEnvelope,
  type FigmaMotionSharedEnvelope,
  type FigmaMotionSharedEnvelopeResult,
  type FigmaMotionSharedPayload,
  type FigmaMotionSharedPayloadResult,
  type FigmaNativeMotionApplyOptions,
  type FigmaNativeMotionApplyRequest,
  type FigmaNativeMotionConflictPolicy,
  type FigmaNativeMotionDiagnostic,
  type FigmaNativeMotionDiagnosticCode,
  type FigmaNativeMotionDiagnosticSeverity,
  type FigmaNativeMotionDiff,
  type FigmaNativeMotionEasing,
  type FigmaNativeMotionFieldName,
  type FigmaNativeMotionImportResult,
  type FigmaNativeMotionImportSource,
  type FigmaNativeMotionInspection,
  type FigmaNativeMotionIssue,
  type FigmaNativeMotionKeyframe,
  type FigmaNativeMotionOperation,
  type FigmaNativeMotionOptions,
  type FigmaNativeMotionOwnershipChange,
  type FigmaNativeMotionOwnershipRecord,
  type FigmaNativeMotionOwnershipStatus,
  type FigmaNativeMotionPlan,
  type FigmaNativeMotionScriptOptions,
  type FigmaNativeMotionTransactionHost,
  type FigmaNativeMotionTransactionResult,
  type FigmaNativeMotionTransactionStatus,
  type FigmaNativeMotionTransactionTarget,
  type FigmaNativeMotionSharedMirrorStatus,
  type FigmaNativeMotionSnapshot,
  type FigmaNativeMotionTimelineChange,
  type FigmaNativeMotionTimelineGrowth,
  type FigmaNativeMotionTimelineInspection,
  type FigmaNativeMotionWarning
} from './motion-native'

import {
  FIG_KIWI_DEFAULT_VERSION,
  buildFigKiwi,
  decompressFigKiwiData,
  parseFigKiwiChunks
} from '@open-pencil/kiwi/fig/container'

export interface FigDocumentSource {
  readonly bytes?: Uint8Array
  readonly fileName?: string
}

export interface FigDocument<Graph = unknown> {
  readonly graph: Graph
  readonly source?: FigDocumentSource
}

export interface ReadFigOptions {
  readonly preserveRawMetadata?: boolean
}

export interface WriteFigOptions {
  readonly source?: FigDocumentSource
}

export interface FigContainerDocument {
  readonly schemaDeflated: Uint8Array
  readonly dataRaw: Uint8Array
  readonly source?: FigDocumentSource
}

export interface ReadFigContainerOptions {
  readonly fileName?: string
}

export interface WriteFigContainerOptions {
  readonly version?: number
}

export const FIG_PACKAGE_STATUS = 'archive-api' as const

export function readFigContainer(
  bytes: Uint8Array,
  options: ReadFigContainerOptions = {}
): FigContainerDocument {
  const chunks = parseFigKiwiChunks(bytes)
  if (!chunks) throw new Error('Invalid fig-kiwi container')
  const [schemaDeflated, dataDeflated] = chunks
  return {
    schemaDeflated,
    dataRaw: decompressFigKiwiData(dataDeflated),
    source: { bytes, fileName: options.fileName }
  }
}

export function writeFigContainer(
  document: FigContainerDocument,
  options: WriteFigContainerOptions = {}
): Uint8Array {
  return buildFigKiwi(
    document.schemaDeflated,
    document.dataRaw,
    options.version ?? FIG_KIWI_DEFAULT_VERSION
  )
}

export function assertFigPackageReady(): void {
  throw new Error(
    '@open-pencil/fig currently exposes archive/container APIs; use @open-pencil/core for SceneGraph .fig read/write APIs for now.'
  )
}
