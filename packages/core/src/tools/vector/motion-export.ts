import type { MotionTrigger } from '@open-pencil/scene-graph'

import { encodeBase64 } from '#core/bytes'
import {
  exportGraphMotion,
  type MotionExportFormat,
  type MotionExportReducedMotion
} from '#core/io/motion-export'
import { defineTool } from '#core/tools/schema'

const FORMATS = new Set<MotionExportFormat>(['png-sequence', 'gif', 'webm', 'mp4'])
const REDUCED_MOTION = new Set<MotionExportReducedMotion>(['allow', 'reduce', 'disable'])
const TRIGGERS = new Set<MotionTrigger | 'all'>([
  'all',
  'mount',
  'pageEnter',
  'pageExit',
  'hover',
  'press',
  'focus',
  'click',
  'inView',
  'loop'
])

export const exportMotionAnimation = defineTool({
  name: 'export_motion_animation',
  description:
    'Export a deterministic MotionSpec or Motion scene animation. PNG sequence and GIF are built in; WebM/MP4 fail closed unless a real platform encoder is registered. Built-in AI opens the app save surface, while MCP restricts output to OPENPENCIL_MCP_ROOT.',
  params: {
    ids: {
      type: 'string[]',
      description:
        'Animated node IDs. Omit when owner_id and sequence_id select a Motion scene; otherwise current selection is used.'
    },
    owner_id: {
      type: 'string',
      description: 'Motion scene owner page/frame ID'
    },
    sequence_id: {
      type: 'string',
      description: 'Motion scene sequence ID'
    },
    trigger: {
      type: 'string',
      enum: [...TRIGGERS],
      default: 'all',
      description: 'Node-local track trigger selection'
    },
    track_id: {
      type: 'string',
      description: 'Optional single node-local Motion track ID'
    },
    format: {
      type: 'string',
      enum: [...FORMATS],
      default: 'png-sequence',
      description: 'Animation output format'
    },
    fps: {
      type: 'number',
      min: 1,
      max: 120,
      default: 30,
      description: 'Integer frames per second'
    },
    loops: {
      type: 'number',
      min: 1,
      max: 100,
      default: 1,
      description: 'Finite output loop count'
    },
    scale: {
      type: 'number',
      min: 0.1,
      max: 4,
      default: 1,
      description: 'Raster scale multiplier'
    },
    padding: {
      type: 'number',
      min: 0,
      max: 4096,
      default: 0,
      description: 'Fixed document-space padding around the export target'
    },
    duration_ms: {
      type: 'number',
      min: 1,
      max: 120000,
      description: 'Optional deterministic duration override in milliseconds'
    },
    reduced_motion: {
      type: 'string',
      enum: [...REDUCED_MOTION],
      default: 'allow',
      description: 'Accessibility export policy: allow, reduce, or disable'
    },
    path: {
      type: 'string',
      required: true,
      description:
        'Suggested save name in built-in AI, or an output directory/file inside OPENPENCIL_MCP_ROOT when called through MCP'
    }
  },
  execute: async (figma, args, ctx) => {
    if (!figma.exportImage) {
      return { error: 'Motion animation export is not available in this environment' }
    }
    const format = args.format ?? 'png-sequence'
    if (!FORMATS.has(format as MotionExportFormat)) throw new Error(`Unknown format: ${format}`)
    const reducedMotion = args.reduced_motion ?? 'allow'
    if (!REDUCED_MOTION.has(reducedMotion as MotionExportReducedMotion)) {
      throw new Error(`Unknown reduced-motion policy: ${reducedMotion}`)
    }
    const trigger = args.trigger ?? 'all'
    if (!TRIGGERS.has(trigger as MotionTrigger | 'all')) {
      throw new Error(`Unknown Motion trigger: ${trigger}`)
    }
    const hasSceneOwner = typeof args.owner_id === 'string'
    const hasSequence = typeof args.sequence_id === 'string'
    if (hasSceneOwner !== hasSequence) {
      throw new Error('owner_id and sequence_id must be provided together')
    }
    const selectedIds = figma.currentPage.selection.map((node) => node.id)
    const ids = args.ids && args.ids.length > 0 ? args.ids : selectedIds
    if (!hasSceneOwner && ids.length === 0) {
      throw new Error('Select at least one animated node or provide ids')
    }

    const source = hasSceneOwner
      ? ({
          kind: 'scene',
          ownerNodeId: args.owner_id as string,
          sequenceId: args.sequence_id as string
        } as const)
      : ({
          kind: 'nodes',
          nodeIds: ids,
          trigger: trigger as MotionTrigger | 'all',
          trackId: args.track_id
        } as const)
    const result = await exportGraphMotion({
      graph: figma.graph,
      pageId: figma.currentPageId,
      source,
      format: format as MotionExportFormat,
      fps: args.fps,
      loops: args.loops,
      scale: args.scale,
      padding: args.padding,
      durationMs: args.duration_ms,
      reducedMotion: reducedMotion as MotionExportReducedMotion,
      signal: ctx?.signal,
      onProgress: ctx?.onProgress,
      renderFrame: async ({ nodeIds, scale, bounds, visuals, frame, generatedEffectMode }) =>
        figma.exportImage?.([...nodeIds], {
          format: 'PNG',
          scale,
          bounds,
          motionVisualStates: visuals,
          generatedEffectTimeMs: frame.localTimeUs / 1_000,
          generatedEffectMode
        }) ?? null
    })

    if (ctx?.saveMotionExport) {
      const saved = await ctx.saveMotionExport(result, args.path, ctx.signal)
      return {
        saved,
        cancelled: !saved,
        format: result.format,
        frameCount: result.plan.frameCount,
        fps: result.plan.fps,
        loops: result.plan.loops,
        width: result.plan.pixelWidth,
        height: result.plan.pixelHeight,
        issues: result.issues
      }
    }

    if (result.format === 'png-sequence') {
      return {
        format: result.format,
        manifest: result.manifest,
        issues: result.issues,
        frames: result.frames.map((frame) => ({
          file: frame.fileName,
          base64: encodeBase64(frame.bytes),
          byteLength: frame.byteLength
        }))
      }
    }
    return {
      format: result.format,
      mimeType: result.mimeType,
      extension: result.extension,
      base64: encodeBase64(result.bytes),
      byteLength: result.byteLength,
      encoder: result.encoder,
      issues: result.issues
    }
  }
})
