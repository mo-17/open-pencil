import { zipSync, type Zippable } from 'fflate'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import {
  exportGraphMotion,
  MotionExportCancelledError,
  type MotionAnimationEncoder,
  type MotionAnimationExportResult,
  type MotionExportCapability,
  type MotionExportFormat,
  type MotionGraphExportSource,
  type MotionExportProgress,
  type MotionExportReducedMotion,
  type MotionPNGSequenceResult
} from '@open-pencil/core/io/motion-export'

import { chooseTauriExportPath } from '@/app/document/export/files'
import { useEditorStore } from '@/app/editor/active-store'
import { isTauri } from '@/app/tauri/env'

import {
  createMotionWebmCapabilityPreflight,
  getMotionWebmExportCapabilities,
  type MotionWebmCapabilityState
} from './webm-capability'

export type AppMotionAnimationFormat = Extract<MotionExportFormat, 'png-sequence' | 'gif' | 'webm'>
export type AppMotionExportSourceMode = MotionGraphExportSource['kind']

const FIXED_ZIP_TIME = new Date('1980-01-01T00:00:00.000Z')

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new MotionExportCancelledError()
}

function safeFileStem(value: string): string {
  const withoutControl = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
  const stem = withoutControl
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return stem || 'Motion'
}

function pngSequenceZip(result: MotionPNGSequenceResult): Uint8Array {
  const entries: Zippable = {
    'manifest.json': new TextEncoder().encode(`${JSON.stringify(result.manifest, null, 2)}\n`)
  }
  for (const frame of result.frames) entries[frame.fileName] = frame.bytes
  return zipSync(entries, { level: 0, mtime: FIXED_ZIP_TIME })
}

function download(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function saveBrowserFile(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  signal: AbortSignal
): Promise<boolean> {
  throwIfCancelled(signal)
  // Browser File System Access handles can truncate an existing user-selected
  // file and provide no exclusive-create flag. Delegate collision handling to
  // the browser download manager instead of claiming programmatic no-clobber.
  download(bytes, fileName, mimeType)
  return true
}

type TauriMotionExportInvoker = <T>(
  command: string,
  args: { path: string; data: number[] }
) => Promise<T>

/** Claim the selected Tauri path atomically; never truncate a racing file. */
export async function writeTauriMotionFileNoClobber(
  path: string,
  bytes: Uint8Array,
  invoker?: TauriMotionExportInvoker
): Promise<void> {
  const invoke = invoker ?? (await import('@tauri-apps/api/core')).invoke
  try {
    await invoke('write_motion_export_noclobber', {
      path,
      data: Array.from(bytes)
    })
  } catch (cause) {
    throw new Error(`Could not create output without replacing an existing path: ${path}`, {
      cause
    })
  }
}

async function saveTauriFileNoClobber(
  bytes: Uint8Array,
  fileName: string,
  formatLabel: string,
  extension: string,
  signal: AbortSignal
): Promise<boolean> {
  throwIfCancelled(signal)
  const path = await chooseTauriExportPath(fileName, formatLabel, extension)
  if (!path) return false
  throwIfCancelled(signal)
  await writeTauriMotionFileNoClobber(path, bytes)
  return true
}

export async function saveMotionAnimationResult(
  result: MotionAnimationExportResult,
  name: string,
  signal = new AbortController().signal
): Promise<boolean> {
  const stem = `${safeFileStem(name)}-motion`
  const output =
    result.format === 'png-sequence'
      ? {
          bytes: pngSequenceZip(result),
          fileName: `${stem}-png-sequence.zip`,
          mimeType: 'application/zip',
          extension: '.zip',
          formatLabel: 'PNG sequence ZIP'
        }
      : {
          bytes: result.bytes,
          fileName: `${stem}.${result.extension}`,
          mimeType: result.mimeType,
          extension: `.${result.extension}`,
          formatLabel: result.format.toUpperCase()
        }
  return isTauri()
    ? saveTauriFileNoClobber(
        output.bytes,
        output.fileName,
        output.formatLabel,
        output.extension,
        signal
      )
    : saveBrowserFile(output.bytes, output.fileName, output.mimeType, signal)
}

export function useMotionAnimationExport() {
  const editor = useEditorStore()
  const sourceMode = ref<AppMotionExportSourceMode>('nodes')
  const sceneSequenceId = ref('')
  const format = ref<AppMotionAnimationFormat>('gif')
  const fps = ref(30)
  const loops = ref(1)
  const reducedMotion = ref<MotionExportReducedMotion>('allow')
  const progress = shallowRef<MotionExportProgress | null>(null)
  const error = ref('')
  const saved = ref(false)
  const exporting = ref(false)
  const webmCapability = shallowRef<MotionWebmCapabilityState>({ status: 'idle' })
  let controller: AbortController | null = null

  const selectedNodes = computed(() => {
    void editor.state.sceneVersion
    return [...editor.state.selectedIds]
      .map((id) => editor.graph.getNode(id))
      .filter((node) => node !== undefined)
  })
  const animatedNodeIds = computed(() =>
    selectedNodes.value.flatMap((node) => (node.motion?.tracks.length ? [node.id] : []))
  )
  const sceneOwner = computed(() => {
    void editor.state.sceneVersion
    const selected = selectedNodes.value.length === 1 ? selectedNodes.value[0] : undefined
    if (
      (selected?.type === 'CANVAS' || selected?.type === 'FRAME') &&
      selected.motionScene?.sequences.some(({ cues }) => cues.length > 0)
    ) {
      return selected
    }
    const page = editor.graph.getNode(editor.state.currentPageId)
    return page?.type === 'CANVAS' &&
      page.motionScene?.sequences.some(({ cues }) => cues.length > 0)
      ? page
      : null
  })
  const sceneSequenceOptions = computed(
    () =>
      sceneOwner.value?.motionScene?.sequences
        .filter(({ cues }) => cues.length > 0)
        .map((sequence) => ({
          value: sequence.id,
          label: `${sequence.id} · ${sequence.trigger}`,
          targetCount: new Set(sequence.cues.map(({ targetNodeId }) => targetNodeId)).size
        })) ?? []
  )
  const nodeSourceAvailable = computed(() => animatedNodeIds.value.length > 0)
  const sceneSourceAvailable = computed(() => sceneSequenceOptions.value.length > 0)
  const source = computed<MotionGraphExportSource | null>(() => {
    if (sourceMode.value === 'scene') {
      const owner = sceneOwner.value
      if (
        !owner ||
        !sceneSequenceOptions.value.some(({ value }) => value === sceneSequenceId.value)
      ) {
        return null
      }
      return { kind: 'scene', ownerNodeId: owner.id, sequenceId: sceneSequenceId.value }
    }
    return nodeSourceAvailable.value
      ? { kind: 'nodes', nodeIds: animatedNodeIds.value, trigger: 'all' }
      : null
  })
  const exportTargetCount = computed(() => {
    if (source.value?.kind === 'nodes') return source.value.nodeIds.length
    return (
      sceneSequenceOptions.value.find(({ value }) => value === sceneSequenceId.value)
        ?.targetCount ?? 0
    )
  })
  const hasExportSource = computed(() => source.value !== null)
  const activeName = computed(() => {
    if (source.value?.kind === 'scene') {
      return `${sceneOwner.value?.name ?? 'Scene'}-${source.value.sequenceId}`
    }
    if (animatedNodeIds.value.length !== 1) return `${animatedNodeIds.value.length} nodes`
    return editor.graph.getNode(animatedNodeIds.value[0])?.name ?? 'Motion'
  })
  const normalizedFps = computed(() => {
    const value = Math.round(fps.value)
    const maximum = format.value === 'gif' ? 100 : 120
    return Number.isFinite(value) ? Math.max(1, Math.min(maximum, value)) : 30
  })
  const normalizedLoops = computed(() => {
    const value = Math.round(loops.value)
    return Number.isFinite(value) ? Math.max(1, Math.min(100, value)) : 1
  })
  const platformEncoders = computed<readonly MotionAnimationEncoder[]>(() =>
    webmCapability.value.status === 'available' ? [webmCapability.value.encoder] : []
  )
  const capabilityLoading = computed(
    () => format.value === 'webm' && webmCapability.value.status === 'loading'
  )
  const capabilities = computed<readonly MotionExportCapability[]>(() =>
    getMotionWebmExportCapabilities(webmCapability.value)
  )
  const activeCapability = computed(
    () => capabilities.value.find((capability) => capability.format === format.value) ?? null
  )
  const canExport = computed(
    () =>
      hasExportSource.value &&
      activeCapability.value?.available === true &&
      !capabilityLoading.value &&
      !exporting.value
  )

  const webmPreflight = createMotionWebmCapabilityPreflight({
    onState(state) {
      webmCapability.value = state
    }
  })

  const sourceSignature = computed(() => {
    const value = source.value
    if (!value) return ''
    return value.kind === 'scene'
      ? `scene:${value.ownerNodeId}:${value.sequenceId}`
      : `nodes:${value.nodeIds.join('\u0000')}:${value.trigger ?? ''}:${value.trackId ?? ''}`
  })

  watch(
    () => ({
      format: format.value,
      fps: normalizedFps.value,
      loops: normalizedLoops.value,
      reducedMotion: reducedMotion.value,
      pageId: editor.state.currentPageId,
      sceneVersion: editor.state.sceneVersion,
      source: sourceSignature.value
    }),
    () => {
      const exportSource = source.value
      if (format.value !== 'webm' || !exportSource) {
        webmPreflight.clear()
        return
      }
      const sourceSnapshot: MotionGraphExportSource =
        exportSource.kind === 'scene'
          ? { ...exportSource }
          : { ...exportSource, nodeIds: [...exportSource.nodeIds] }
      webmPreflight.schedule({
        graph: editor.graph,
        pageId: editor.state.currentPageId,
        source: sourceSnapshot,
        fps: normalizedFps.value,
        loops: normalizedLoops.value,
        reducedMotion: reducedMotion.value
      })
    },
    { immediate: true, flush: 'sync' }
  )

  watch(
    () => ({
      nodeAvailable: nodeSourceAvailable.value,
      sceneAvailable: sceneSourceAvailable.value,
      sceneOwnerId: sceneOwner.value?.id ?? '',
      sequenceIds: sceneSequenceOptions.value.map(({ value }) => value).join('\u0000')
    }),
    ({ nodeAvailable, sceneAvailable }) => {
      if (!sceneSequenceOptions.value.some(({ value }) => value === sceneSequenceId.value)) {
        sceneSequenceId.value = sceneSequenceOptions.value[0]?.value ?? ''
      }
      if (sourceMode.value === 'nodes' && !nodeAvailable && sceneAvailable)
        sourceMode.value = 'scene'
      else if (sourceMode.value === 'scene' && !sceneAvailable && nodeAvailable) {
        sourceMode.value = 'nodes'
      }
    },
    { immediate: true }
  )

  function cancel(): void {
    controller?.abort()
  }

  async function start(): Promise<void> {
    if (!canExport.value) return
    const renderer = editor.renderer
    if (!renderer) {
      error.value = 'Canvas renderer is unavailable.'
      return
    }
    const exportController = new AbortController()
    controller = exportController
    error.value = ''
    saved.value = false
    progress.value = { phase: 'prepare', completed: 0, total: 1 }
    exporting.value = true
    try {
      const exportSource = source.value
      if (!exportSource) return
      const result = await exportGraphMotion({
        graph: editor.graph,
        pageId: editor.state.currentPageId,
        source: exportSource,
        format: format.value,
        fps: normalizedFps.value,
        loops: normalizedLoops.value,
        reducedMotion: reducedMotion.value,
        signal: exportController.signal,
        encoders: platformEncoders.value,
        onProgress(value) {
          progress.value = value
        },
        renderFrame: async (request) =>
          renderNodesToImage(
            renderer.ck,
            renderer,
            request.graph,
            request.pageId,
            [...request.nodeIds],
            {
              format: 'PNG',
              scale: request.scale,
              bounds: request.bounds,
              motionVisualStates: request.visuals,
              generatedEffectTimeMs: request.frame.localTimeUs / 1_000,
              generatedEffectMode: request.generatedEffectMode
            }
          )
      })
      saved.value = await saveMotionAnimationResult(
        result,
        activeName.value,
        exportController.signal
      )
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'MotionExportCancelledError')) {
        error.value = cause instanceof Error ? cause.message : String(cause)
      }
    } finally {
      controller = null
      exporting.value = false
    }
  }

  onBeforeUnmount(() => {
    cancel()
    webmPreflight.dispose()
  })

  return {
    format,
    fps,
    loops,
    reducedMotion,
    progress,
    error,
    saved,
    exporting,
    capabilityLoading,
    animatedNodeIds,
    exportTargetCount,
    hasExportSource,
    sourceMode,
    nodeSourceAvailable,
    sceneSourceAvailable,
    sceneOwner,
    sceneSequenceId,
    sceneSequenceOptions,
    activeName,
    capabilities,
    activeCapability,
    canExport,
    start,
    cancel
  }
}
