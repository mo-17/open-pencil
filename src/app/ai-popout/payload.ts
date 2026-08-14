import { parseAIPopoutControls, type AIPopoutControls } from '@/app/ai/popout/controls'
import { parseAIPopoutProjection, type AIPopoutProjection } from '@/app/ai/popout/protocol'

const MAX_ENVELOPE_BYTES = 768 * 1024
const PAYLOAD_KEYS = new Set<PropertyKey>(['envelope', 'controls', 'revision'])
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

interface AIPopoutPayloadCandidate {
  envelope?: unknown
  controls?: unknown
  revision?: unknown
}

export interface AIPopoutPayload {
  readonly projection: AIPopoutProjection
  readonly controls: AIPopoutControls
  readonly revision: number
}

function decodeEnvelope(envelope: string): unknown {
  if (
    envelope.length === 0 ||
    envelope.length > MAX_ENVELOPE_BYTES ||
    envelope.length % 4 !== 0 ||
    !CANONICAL_BASE64.test(envelope)
  ) {
    throw new TypeError('AI window payload envelope is invalid.')
  }

  let binary: string
  try {
    binary = atob(envelope)
  } catch {
    throw new TypeError('AI window payload envelope is invalid.')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  let json: string
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new TypeError('AI window payload must contain UTF-8 JSON.')
  }
  try {
    return JSON.parse(json) as unknown
  } catch {
    throw new TypeError('AI window payload must contain valid JSON.')
  }
}

export function parseAIPopoutPayload(value: unknown): AIPopoutPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('AI window payload must be an object.')
  }
  const source = value as AIPopoutPayloadCandidate
  if (
    Reflect.ownKeys(value).length !== PAYLOAD_KEYS.size ||
    Reflect.ownKeys(value).some((key) => !PAYLOAD_KEYS.has(key)) ||
    typeof source.envelope !== 'string' ||
    typeof source.revision !== 'number' ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1
  ) {
    throw new TypeError('AI window payload is invalid.')
  }
  return Object.freeze({
    projection: parseAIPopoutProjection(decodeEnvelope(source.envelope)),
    controls: parseAIPopoutControls(source.controls),
    revision: source.revision
  })
}
