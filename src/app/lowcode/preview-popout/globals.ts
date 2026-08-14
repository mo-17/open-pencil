export const COMPILER_PREVIEW_POPOUT_INITIAL = '__OPENPENCIL_PREVIEW_POPOUT_INITIAL__'
export const COMPILER_PREVIEW_POPOUT_PENDING = '__OPENPENCIL_PREVIEW_POPOUT_PENDING__'
export const COMPILER_PREVIEW_POPOUT_UPDATE = '__OPENPENCIL_PREVIEW_POPOUT_UPDATE__'

export interface CompilerPreviewPopoutGlobalTarget {
  __OPENPENCIL_PREVIEW_POPOUT_INITIAL__?: unknown
  __OPENPENCIL_PREVIEW_POPOUT_PENDING__?: unknown
  __OPENPENCIL_PREVIEW_POPOUT_UPDATE__?: (payload: unknown) => void
}

type UpdateReceiver = (payload: unknown) => void
type LatestPayloadRequest = () => Promise<unknown>

function takeInitial(target: CompilerPreviewPopoutGlobalTarget): {
  present: boolean
  value: unknown
} {
  const present = Object.hasOwn(target, '__OPENPENCIL_PREVIEW_POPOUT_INITIAL__')
  const value = target.__OPENPENCIL_PREVIEW_POPOUT_INITIAL__
  delete target.__OPENPENCIL_PREVIEW_POPOUT_INITIAL__
  return { present, value }
}

function takePending(target: CompilerPreviewPopoutGlobalTarget): {
  present: boolean
  value: unknown
} {
  const present = Object.hasOwn(target, '__OPENPENCIL_PREVIEW_POPOUT_PENDING__')
  const value = target.__OPENPENCIL_PREVIEW_POPOUT_PENDING__
  delete target.__OPENPENCIL_PREVIEW_POPOUT_PENDING__
  return { present, value }
}

/**
 * Install synchronously, then consume native initialization and any update
 * queued before the module ran. The controller's monotonic revision gate makes
 * delivery order harmless if a newer callback lands during startup.
 */
export function installCompilerPreviewPopoutReceiver(
  target: CompilerPreviewPopoutGlobalTarget,
  update: UpdateReceiver
): () => void {
  const initial = takeInitial(target)
  const pending = takePending(target)
  const receiver = update
  target[COMPILER_PREVIEW_POPOUT_UPDATE] = receiver
  if (initial.present) update(initial.value)
  if (pending.present) update(pending.value)

  return () => {
    if (target[COMPILER_PREVIEW_POPOUT_UPDATE] === receiver) {
      delete target.__OPENPENCIL_PREVIEW_POPOUT_UPDATE__
    }
  }
}

/**
 * Reliably replay native state after the synchronous receiver is installed.
 * The caller deliberately supplies the popup-only native request so this
 * module stays independent from Tauri and remains unit-testable.
 */
export async function requestCompilerPreviewPopoutLatestPayload(
  requestLatest: LatestPayloadRequest,
  update: UpdateReceiver
): Promise<void> {
  const payload = await requestLatest()
  update(payload)
}
