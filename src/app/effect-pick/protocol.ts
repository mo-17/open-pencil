import * as v from 'valibot'

export const EFFECT_PICK_PREVIEW_PROTOCOL = 'open-pencil-effect-pick-preview-v1'

const envelope = {
  protocol: v.literal(EFFECT_PICK_PREVIEW_PROTOCOL),
  instanceId: v.pipe(v.string(), v.uuid())
}

const inbound = v.variant('type', [
  v.strictObject({ ...envelope, type: v.literal('ready') }),
  v.strictObject({ ...envelope, type: v.literal('mounted') }),
  v.strictObject({ ...envelope, type: v.literal('loaded') }),
  v.strictObject({ ...envelope, type: v.literal('click') }),
  v.strictObject({
    ...envelope,
    type: v.literal('error'),
    message: v.pipe(v.string(), v.maxLength(500))
  })
])

export type EffectPickPreviewMessage = v.InferOutput<typeof inbound>

export function parseEffectPickPreviewMessage(
  value: unknown,
  instanceId: string
): EffectPickPreviewMessage | null {
  const result = v.safeParse(inbound, value)
  return result.success && result.output.instanceId === instanceId ? result.output : null
}

export function parseEffectPickReadyEvent(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  source: MessageEventSource | null,
  instanceId: string
): EffectPickPreviewMessage | null {
  if (!source || event.source !== source || event.origin !== 'null') return null
  const message = parseEffectPickPreviewMessage(event.data, instanceId)
  return message?.type === 'ready' ? message : null
}
