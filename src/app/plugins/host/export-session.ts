import { shallowRef } from 'vue'

import { createPluginExportAbortError } from './exporter-abort'

export type AppPluginExportStage =
  | 'choosing-destination'
  | 'preparing'
  | 'compiling'
  | 'archiving'
  | 'saving'
  | 'cancelling'

export interface AppPluginExportSessionSnapshot {
  pluginId: string
  exporterId: string
  stage: AppPluginExportStage
  startedAt: number
}

interface ActiveExportSession extends AppPluginExportSessionSnapshot {
  controller: AbortController
  token: symbol
}

export const appPluginExportSessionSnapshot = shallowRef<AppPluginExportSessionSnapshot | null>(
  null
)

let activeSession: ActiveExportSession | null = null

function publish(session: ActiveExportSession | null): void {
  appPluginExportSessionSnapshot.value = session
    ? {
        pluginId: session.pluginId,
        exporterId: session.exporterId,
        stage: session.stage,
        startedAt: session.startedAt
      }
    : null
}

export function isAppPluginExportActive(pluginId?: string): boolean {
  return activeSession !== null && (pluginId === undefined || activeSession.pluginId === pluginId)
}

export function updateAppPluginExportStage(
  pluginId: string,
  exporterId: string,
  stage: Exclude<AppPluginExportStage, 'cancelling'>
): void {
  if (
    !activeSession ||
    activeSession.pluginId !== pluginId ||
    activeSession.exporterId !== exporterId ||
    activeSession.controller.signal.aborted
  ) {
    return
  }
  activeSession.stage = stage
  publish(activeSession)
}

export function updateActiveAppPluginExportStage(
  stage: Exclude<AppPluginExportStage, 'cancelling'>
): void {
  if (!activeSession || activeSession.controller.signal.aborted) return
  activeSession.stage = stage
  publish(activeSession)
}

export function cancelAppPluginExport(pluginId?: string): boolean {
  const session = activeSession
  if (!session || (pluginId !== undefined && session.pluginId !== pluginId)) return false
  if (session.controller.signal.aborted) return true
  session.stage = 'cancelling'
  publish(session)
  session.controller.abort(createPluginExportAbortError())
  return true
}

export async function runAppPluginExportSession<Result>(options: {
  pluginId: string
  exporterId: string
  signal?: AbortSignal
  operation(signal: AbortSignal): Promise<Result>
}): Promise<Result> {
  if (activeSession) {
    throw new Error(
      `Plugin export is already running: ${activeSession.pluginId}/${activeSession.exporterId}`
    )
  }

  const controller = new AbortController()
  const token = Symbol('plugin-export-session')
  const session: ActiveExportSession = {
    pluginId: options.pluginId,
    exporterId: options.exporterId,
    stage: 'choosing-destination',
    startedAt: Date.now(),
    controller,
    token
  }
  const abortFromParent = (): void => {
    controller.abort(options.signal?.reason ?? createPluginExportAbortError())
  }
  if (options.signal?.aborted) abortFromParent()
  else options.signal?.addEventListener('abort', abortFromParent, { once: true })

  activeSession = session
  publish(session)
  try {
    return await options.operation(controller.signal)
  } finally {
    options.signal?.removeEventListener('abort', abortFromParent)
    if (activeSession.token === token) {
      activeSession = null
      publish(null)
    }
  }
}
