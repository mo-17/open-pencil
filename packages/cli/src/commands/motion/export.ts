import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { defineCommand } from 'citty'

import {
  exportGraphMotion,
  getMotionExportCapabilities,
  MotionExportCancelledError,
  type MotionEncodedAnimationResult,
  type MotionExportFormat,
  type MotionExportReducedMotion,
  type MotionGraphExportSource,
  type MotionPNGSequenceResult
} from '@open-pencil/core/io'
import {
  discoverFfmpegMotionEncoders,
  publishDirectoryNoClobber,
  publishFileNoClobber
} from '@open-pencil/mcp/motion-export'
import type { MotionTrigger, SceneGraph } from '@open-pencil/scene-graph'

import { bold, dim, fmtList, fmtSummary, ok, printError } from '#cli/format'
import { loadDocument, populateWholeDocument } from '#cli/headless'

import { createMotionExportProgressReporter } from './export-progress'

const FORMATS: readonly MotionExportFormat[] = ['png-sequence', 'gif', 'webm', 'mp4']
const REDUCED_MOTION: readonly MotionExportReducedMotion[] = ['allow', 'reduce', 'disable']
const TRIGGERS: readonly (MotionTrigger | 'all')[] = [
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
]

function includesOption<T extends string>(options: readonly T[], value: string): value is T {
  return options.some((option) => option === value)
}

function fileErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (fileErrorCode(error) === 'ENOENT') return false
    throw error
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new MotionExportCancelledError()
}

async function prepareTemporaryOutput(output: string): Promise<{
  directory: string
  file: string
}> {
  if (await exists(output)) throw new Error(`Output already exists: ${output}`)
  const parent = dirname(output)
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, `.${basename(output)}.tmp-`))
  return { directory, file: join(directory, basename(output)) }
}

async function writePNGSequenceAtomic(
  output: string,
  result: MotionPNGSequenceResult,
  signal: AbortSignal
): Promise<{ output: string; byteLength: number }> {
  const { directory: temporary } = await prepareTemporaryOutput(output)
  let moved = false
  try {
    let byteLength = 0
    for (const frame of result.frames) {
      throwIfCancelled(signal)
      await writeFile(join(temporary, frame.fileName), frame.bytes)
      byteLength += frame.byteLength
    }
    const manifest = `${JSON.stringify(result.manifest, null, 2)}\n`
    await writeFile(join(temporary, 'manifest.json'), manifest, 'utf8')
    byteLength += Buffer.byteLength(manifest, 'utf8')
    throwIfCancelled(signal)
    await publishDirectoryNoClobber(temporary, output)
    moved = true
    return { output, byteLength }
  } finally {
    if (!moved) await rm(temporary, { recursive: true, force: true })
  }
}

async function writeEncodedAnimationAtomic(
  output: string,
  result: MotionEncodedAnimationResult,
  signal: AbortSignal
): Promise<{ output: string; byteLength: number }> {
  const { directory: temporary, file: temporaryFile } = await prepareTemporaryOutput(output)
  try {
    throwIfCancelled(signal)
    await writeFile(temporaryFile, result.bytes)
    throwIfCancelled(signal)
    await publishFileNoClobber(temporaryFile, output)
    return { output, byteLength: result.byteLength }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function parseFormat(value: string): MotionExportFormat {
  if (!includesOption(FORMATS, value)) {
    throw new Error(`Unknown format "${value}". Expected png-sequence, gif, webm, or mp4.`)
  }
  return value
}

function parseReducedMotion(value: string): MotionExportReducedMotion {
  if (!includesOption(REDUCED_MOTION, value)) {
    throw new Error(`Unknown reduced-motion policy "${value}". Expected allow, reduce, or disable.`)
  }
  return value
}

function parseTrigger(value: string): MotionTrigger | 'all' {
  if (!includesOption(TRIGGERS, value)) {
    throw new Error(`Unknown Motion trigger: ${value}`)
  }
  return value
}

function findPage(graph: SceneGraph, nodeIds: readonly string[]): string {
  const page = graph
    .getPages()
    .find((candidate) =>
      nodeIds.every((nodeId) => nodeId === candidate.id || graph.isDescendant(nodeId, candidate.id))
    )
  if (!page) throw new Error('Motion export targets must exist on one page')
  return page.id
}

function parseNodeIds(value: string | undefined): string[] {
  return value
    ? [
        ...new Set(
          value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        )
      ]
    : []
}

export default defineCommand({
  meta: {
    description: 'Export deterministic MotionSpec frames at a fixed integer timebase'
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Source design document (.fig, .pen)'
    },
    output: {
      type: 'string',
      alias: 'o',
      required: true,
      description: 'New output directory for PNG sequence frames or new encoded output file'
    },
    node: {
      type: 'string',
      description: 'Comma-separated animated node IDs'
    },
    'scene-owner': {
      type: 'string',
      description: 'Motion scene owner page/frame ID'
    },
    sequence: { type: 'string', description: 'Motion scene sequence ID' },
    trigger: {
      type: 'string',
      default: 'all',
      description: 'Node-local trigger selection (default: all)'
    },
    track: { type: 'string', description: 'Optional single node-local track ID' },
    format: {
      type: 'string',
      default: 'png-sequence',
      description: 'png-sequence, gif, webm, or mp4'
    },
    ffmpeg: {
      type: 'string',
      description: 'Optional FFmpeg executable used for WebM/MP4 (or OPENPENCIL_FFMPEG_PATH)'
    },
    fps: { type: 'string', default: '30', description: 'Integer frames per second (1-120)' },
    loops: { type: 'string', default: '1', description: 'Finite loop count (1-100)' },
    scale: { type: 'string', default: '1', description: 'Raster scale (0.1-4)' },
    padding: { type: 'string', default: '0', description: 'Fixed document-space padding' },
    duration: { type: 'string', description: 'Optional duration override in milliseconds' },
    'reduced-motion': {
      type: 'string',
      default: 'allow',
      description: 'Accessibility export policy: allow, reduce, or disable'
    },
    json: { type: 'boolean', default: false, description: 'Output the export report as JSON' }
  },
  async run({ args }) {
    const controller = new AbortController()
    const onInterrupt = () => controller.abort()
    process.once('SIGINT', onInterrupt)
    try {
      const format = parseFormat(args.format)
      const reducedMotion = parseReducedMotion(args['reduced-motion'])
      const owner = args['scene-owner'] || undefined
      const sequence = args.sequence || undefined
      if (Boolean(owner) !== Boolean(sequence)) {
        throw new Error('--scene-owner and --sequence must be provided together')
      }
      const nodeIds = parseNodeIds(args.node)
      if (!owner && nodeIds.length === 0) {
        throw new Error('Provide --node <id[,id...]> or --scene-owner/--sequence')
      }

      const sourceFile = resolve(args.file)
      const graph = await loadDocument(sourceFile)
      populateWholeDocument(graph)
      const source: MotionGraphExportSource =
        owner && sequence
          ? { kind: 'scene', ownerNodeId: owner, sequenceId: sequence }
          : {
              kind: 'nodes',
              nodeIds,
              trigger: parseTrigger(args.trigger),
              trackId: args.track
            }
      const pageId = findPage(graph, owner ? [owner] : nodeIds)
      const outputPath = resolve(args.output)
      if (await exists(outputPath)) throw new Error(`Output already exists: ${outputPath}`)
      const ffmpeg = await discoverFfmpegMotionEncoders({
        executable: args.ffmpeg || undefined
      })
      const reportProgress =
        !args.json && process.stderr.isTTY
          ? createMotionExportProgressReporter((message) => console.error(message))
          : undefined
      const result = await exportGraphMotion({
        graph,
        pageId,
        source,
        format,
        fps: Number(args.fps),
        loops: Number(args.loops),
        scale: Number(args.scale),
        padding: Number(args.padding),
        durationMs: args.duration ? Number(args.duration) : undefined,
        reducedMotion,
        signal: controller.signal,
        onProgress: reportProgress,
        encoders: ffmpeg.encoders
      })
      const written =
        result.format === 'png-sequence'
          ? await writePNGSequenceAtomic(outputPath, result, controller.signal)
          : await writeEncodedAnimationAtomic(outputPath, result, controller.signal)
      const report = {
        version: 1 as const,
        source: { file: sourceFile, pageId, motion: source },
        output: written,
        format: result.format,
        reducedMotion: result.reducedMotion,
        capabilities: getMotionExportCapabilities(ffmpeg.encoders),
        platformEncoder: {
          executable: ffmpeg.executable,
          available: ffmpeg.available,
          version: ffmpeg.version,
          reason: ffmpeg.reason
        },
        ...(result.format === 'png-sequence'
          ? { manifest: result.manifest }
          : {
              encoded: {
                mimeType: result.mimeType,
                extension: result.extension,
                encoder: result.encoder,
                alpha: result.alpha,
                determinism: result.determinism,
                plan: result.plan
              }
            }),
        issues: result.issues
      }
      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        console.log('')
        console.log(bold('  Motion animation export'))
        console.log('')
        console.log(
          fmtSummary({
            frames: result.plan.frameCount,
            fps: result.plan.fps,
            loops: result.plan.loops,
            width: result.plan.pixelWidth,
            height: result.plan.pixelHeight,
            bytes: written.byteLength
          })
        )
        if (result.issues.length > 0) {
          console.log('')
          console.log(
            fmtList(
              result.issues.map((message: string) => ({
                header: dim('warning'),
                details: { message }
              }))
            )
          )
        }
        console.log('')
        console.log(ok(`Wrote ${written.output}`))
        console.log('')
      }
    } catch (error) {
      printError(error)
      process.exitCode = 1
    } finally {
      process.removeListener('SIGINT', onInterrupt)
    }
  }
})
