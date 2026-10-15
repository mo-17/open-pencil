import { describe, expect, test } from 'bun:test'

import {
  localBackendSignInURL,
  parseLocalBackendSignInRequest
} from '@/app/lowcode/preview-pane/iframe/local-backend-auth'

const source = {} as MessageEventSource
const channel = 'preview_channel_0123456789'
const data = {
  type: 'openpencil:local-backend-sign-in',
  version: 1,
  channel,
  requestId: 'a'.repeat(43)
}
const event = { data, source, origin: 'http://127.0.0.1:5181', ports: [] }

describe('embedded local backend sign-in boundary', () => {
  test('opens only the fixed one-use loopback ticket', () => {
    const request = parseLocalBackendSignInRequest(event, source, channel)
    expect<unknown>(request).toEqual(data)
    if (!request) throw new Error('Expected sign-in request')
    expect(localBackendSignInURL(request)).toBe(
      `http://127.0.0.1:5181/_openpencil/preview-auth/start/${data.requestId}`
    )
  })

  test('rejects other frames, origins, channels and transferred capabilities', () => {
    for (const candidate of [
      { ...event, source: null },
      { ...event, origin: 'http://localhost:5181' },
      { ...event, origin: 'http://127.0.0.1:5182' },
      { ...event, origin: 'null' },
      { ...event, data: { ...data, channel: 'stale_channel' } },
      { ...event, ports: [{} as MessagePort] }
    ])
      expect(parseLocalBackendSignInRequest(candidate, source, channel)).toBeNull()
  })

  test('rejects URLs, secrets, malformed tickets and unexpected versions', () => {
    for (const value of [
      null,
      [],
      'bad',
      { ...data, version: 2 },
      { ...data, url: 'https://other.example' },
      { ...data, accessToken: 'must-not-enter-editor' },
      ...['', 'short', '../callback', 'a'.repeat(44), '/'.repeat(43)].map((requestId) => ({
        ...data,
        requestId
      }))
    ])
      expect(parseLocalBackendSignInRequest({ ...event, data: value }, source, channel)).toBeNull()
  })
})
