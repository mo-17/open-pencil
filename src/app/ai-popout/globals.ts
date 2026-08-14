export const AI_POPOUT_INITIAL = '__OPENPENCIL_AI_POPOUT_INITIAL__'
export const AI_POPOUT_PENDING = '__OPENPENCIL_AI_POPOUT_PENDING__'
export const AI_POPOUT_UPDATE = '__OPENPENCIL_AI_POPOUT_UPDATE__'

export interface AIPopoutGlobalTarget {
  __OPENPENCIL_AI_POPOUT_INITIAL__?: unknown
  __OPENPENCIL_AI_POPOUT_PENDING__?: unknown
  __OPENPENCIL_AI_POPOUT_UPDATE__?: (payload: unknown) => void
}

type UpdateReceiver = (payload: unknown) => void
type LatestPayloadRequest = () => Promise<unknown>

function takeInitial(target: AIPopoutGlobalTarget): Readonly<{
  present: boolean
  value: unknown
}> {
  const present = Object.hasOwn(target, '__OPENPENCIL_AI_POPOUT_INITIAL__')
  const value = target.__OPENPENCIL_AI_POPOUT_INITIAL__
  delete target.__OPENPENCIL_AI_POPOUT_INITIAL__
  return { present, value }
}

function takePending(target: AIPopoutGlobalTarget): Readonly<{
  present: boolean
  value: unknown
}> {
  const present = Object.hasOwn(target, '__OPENPENCIL_AI_POPOUT_PENDING__')
  const value = target.__OPENPENCIL_AI_POPOUT_PENDING__
  delete target.__OPENPENCIL_AI_POPOUT_PENDING__
  return { present, value }
}

export function installAIPopoutReceiver(
  target: AIPopoutGlobalTarget,
  update: UpdateReceiver
): () => void {
  const initial = takeInitial(target)
  const pending = takePending(target)
  target[AI_POPOUT_UPDATE] = update
  if (initial.present) update(initial.value)
  if (pending.present) update(pending.value)

  return () => {
    if (target[AI_POPOUT_UPDATE] === update) delete target.__OPENPENCIL_AI_POPOUT_UPDATE__
  }
}

export async function requestAIPopoutLatestPayload(
  requestLatest: LatestPayloadRequest,
  update: UpdateReceiver
): Promise<void> {
  update(await requestLatest())
}
