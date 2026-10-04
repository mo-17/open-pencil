import { onScopeDispose, ref, watch, type Ref } from 'vue'

import type { CompileWarning } from '@open-pencil/compiler'
import { captureFlutterPreviewSnapshot } from '@open-pencil/compiler/flutter-preview'
import type {
  FlutterPreviewDevice,
  FlutterPreviewState
} from '@open-pencil/compiler/flutter-preview'
import { IS_TAURI } from '@open-pencil/core/constants'
import type { SceneGraph } from '@open-pencil/scene-graph'

import type { DocumentSaveStatus } from '@/app/document/io/save'
import {
  flutterPreviewPageIds,
  flutterPreviewScopeKey
} from '@/app/lowcode/application-mode/runtime'

import { createPreviewCompileScheduler, type PreviewRefreshPolicy } from '../compile-scheduler'
import { watchPreviewSaveSync } from '../save-sync'
import { startFlutterNativeProcess, type FlutterNativeProcess } from './process'

export interface FlutterNativeSource {
  readonly graph: SceneGraph
  readonly sceneVersion: number
  readonly currentPageId?: string
  getSaveStatus(): DocumentSaveStatus
}

export function createFlutterNativePreview(
  policy: Ref<PreviewRefreshPolicy>,
  source: FlutterNativeSource,
  options: { desktop?: boolean; startProcess?: typeof startFlutterNativeProcess } = {}
) {
  const devices = ref<FlutterPreviewDevice[]>([])
  const deviceId = ref('')
  const state = ref<FlutterPreviewState>({
    sessionId: null,
    phase: 'idle',
    deviceId: null,
    revision: null,
    projectDirectory: null
  })
  const busy = ref(false)
  const error = ref<string | null>(null)
  const progress = ref('')
  const warnings = ref<CompileWarning[]>([])
  let process: FlutterNativeProcess | undefined
  let opening: Promise<FlutterNativeProcess> | undefined
  let epoch = 0
  let active = false
  let bootstrap = false
  let selectedDevice = ''
  let disposed = false
  const startProcess = options.startProcess ?? startFlutterNativeProcess

  function isCurrent(generation: number): boolean {
    return generation === epoch && !disposed
  }
  function isActive(generation: number): boolean {
    return active && isCurrent(generation)
  }
  function validAcknowledgement(next: FlutterPreviewState, revision: number): boolean {
    return (
      next.phase === 'running' &&
      next.deviceId === selectedDevice &&
      next.revision === revision &&
      next.sessionId !== null &&
      (bootstrap || next.sessionId === state.value.sessionId)
    )
  }

  async function ensureProcess(): Promise<FlutterNativeProcess> {
    if (!(options.desktop ?? IS_TAURI)) throw new Error('Flutter preview requires the desktop app.')
    if (process) return process
    if (opening) return opening
    const generation = epoch
    opening = startProcess(
      (event) => {
        if (generation !== epoch || disposed) return
        if (event.type === 'progress') progress.value = event.message
      },
      (message) => {
        if (generation !== epoch || disposed) return
        ++epoch
        active = false
        busy.value = false
        state.value = { ...state.value, phase: 'failed' }
        error.value = message
        progress.value = ''
        process = undefined
        opening = undefined
      }
    )
      .then(async (opened) => {
        if (generation !== epoch || disposed) {
          await opened.close()
          throw new Error('Flutter preview was stopped.')
        }
        process = opened
        return opened
      })
      .finally(() => {
        if (generation === epoch) opening = undefined
      })
    return opening
  }

  const scheduler = createPreviewCompileScheduler({
    policy: policy.value,
    run: async (request) => {
      if (!isActive(epoch)) return 'superseded'
      const generation = epoch
      busy.value = true
      state.value = { ...state.value, phase: bootstrap ? 'preparing' : 'reloading' }
      try {
        const owned = await ensureProcess()
        if (!isActive(generation)) return 'superseded'
        const snapshot = captureFlutterPreviewSnapshot(
          source.graph,
          flutterPreviewPageIds(source.graph, source.currentPageId)
        )
        const command = bootstrap
          ? {
              version: 1 as const,
              type: 'command' as const,
              id: crypto.randomUUID(),
              command: 'start' as const,
              deviceId: selectedDevice,
              revision: request.revision,
              snapshot
            }
          : {
              version: 1 as const,
              type: 'command' as const,
              id: crypto.randomUUID(),
              command: 'update' as const,
              revision: request.revision,
              snapshot
            }
        const result = await owned.request(command)
        if (!isActive(generation)) return 'superseded'
        if (!validAcknowledgement(result.state, request.revision)) {
          throw new Error('Flutter preview acknowledgement does not match the requested revision.')
        }
        bootstrap = false
        state.value = result.state
        warnings.value = result.warnings ?? []
        progress.value = ''
        error.value = null
        return request.isCurrent() ? 'pushed' : 'superseded'
      } catch (cause) {
        if (!isCurrent(generation)) return 'superseded'
        error.value = cause instanceof Error ? cause.message : String(cause)
        state.value = { ...state.value, phase: 'failed' }
        active = false
        const owned = process
        process = undefined
        ++epoch
        opening = undefined
        await owned?.close()
        return 'failed'
      } finally {
        if (generation === epoch || !active) busy.value = false
      }
    }
  })
  const stopSceneWatch = watch(
    () => source.sceneVersion,
    () => {
      if (active) scheduler.requestChange()
    }
  )
  const stopPolicyWatch = watch(policy, (value) => scheduler.setPolicy(value))
  const stopSaveWatch = watchPreviewSaveSync(
    () => source.getSaveStatus(),
    () => {
      if (active) scheduler.requestSave()
    }
  )
  const stopGraphWatch = watch(
    [
      () => source.graph,
      () => {
        void source.sceneVersion
        return flutterPreviewScopeKey(source.graph, source.currentPageId)
      }
    ],
    () => {
      void stop()
    },
    { flush: 'sync' }
  )

  async function discover(): Promise<void> {
    if (busy.value || active) return
    const generation = epoch
    busy.value = true
    error.value = null
    try {
      const owned = await ensureProcess()
      const result = await owned.request({
        version: 1,
        type: 'command',
        id: crypto.randomUUID(),
        command: 'devices'
      })
      if (generation !== epoch || disposed) return
      devices.value = result.devices ?? []
      if (!devices.value.some((device) => device.id === deviceId.value))
        deviceId.value = devices.value[0]?.id ?? ''
    } catch (cause) {
      if (generation === epoch && !disposed)
        error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (generation === epoch && !disposed) busy.value = false
    }
  }
  function start(): void {
    if (busy.value || active || !devices.value.some((device) => device.id === deviceId.value))
      return
    selectedDevice = deviceId.value
    error.value = null
    warnings.value = []
    active = true
    bootstrap = true
    busy.value = true
    state.value = { ...state.value, phase: 'preparing', deviceId: selectedDevice }
    scheduler.requestInitial()
  }
  function reload(): void {
    if (active) scheduler.flush()
  }
  async function stop(): Promise<void> {
    active = false
    const generation = ++epoch
    const owned = process
    const pending = opening
    process = undefined
    opening = undefined
    busy.value = true
    state.value = { ...state.value, phase: 'stopping' }
    await owned?.close()
    await pending?.catch(() => undefined)
    if (!isCurrent(generation)) return
    busy.value = false
    progress.value = ''
    state.value = {
      sessionId: null,
      phase: 'idle',
      deviceId: null,
      revision: null,
      projectDirectory: null
    }
  }
  onScopeDispose(() => {
    disposed = true
    stopSceneWatch()
    stopPolicyWatch()
    stopSaveWatch()
    stopGraphWatch()
    scheduler.dispose()
    void stop()
  })
  return {
    devices,
    deviceId,
    state,
    busy,
    error,
    progress,
    warnings,
    discover,
    start,
    reload,
    stop
  }
}
