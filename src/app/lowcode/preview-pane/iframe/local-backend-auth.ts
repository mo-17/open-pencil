import * as v from 'valibot'

import { LOCAL_BACKEND_PREVIEW_ORIGIN } from '../local-backend-connection'

const signInRequestSchema = v.strictObject({
  type: v.literal('openpencil:local-backend-sign-in'),
  version: v.literal(1),
  channel: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{16,128}$/)),
  requestId: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/))
})
export type LocalBackendSignInRequest = v.InferOutput<typeof signInRequestSchema>

/** Only an active loopback frame may request opening its one-use sign-in ticket. */
export function parseLocalBackendSignInRequest(
  event: Pick<MessageEvent, 'data' | 'source' | 'origin' | 'ports'>,
  source: MessageEventSource,
  channel: string
): LocalBackendSignInRequest | null {
  if (
    event.source !== source ||
    event.origin !== LOCAL_BACKEND_PREVIEW_ORIGIN ||
    event.ports.length !== 0
  )
    return null
  const result = v.safeParse(signInRequestSchema, event.data)
  return result.success && result.output.channel === channel ? result.output : null
}

export function localBackendSignInURL(request: LocalBackendSignInRequest): string {
  return `${LOCAL_BACKEND_PREVIEW_ORIGIN}/_openpencil/preview-auth/start/${request.requestId}`
}
