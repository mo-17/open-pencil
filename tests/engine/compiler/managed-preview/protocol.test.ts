import { describe, expect, test } from 'bun:test'

import {
  parseManagedPreviewCommand,
  parseManagedPreviewConfig,
  parseManagedPreviewEvent,
  parseManagedPreviewSessionId,
  type ManagedPreviewConfig,
  type ManagedPreviewEvent
} from '@open-pencil/compiler/managed-preview'

import { browserApplication } from '../backend/nestjs/browser-client/helpers'

const SESSION = '12345678-1234-4123-8123-123456789abc'
const DIGEST = 'A'.repeat(43)

function config(): ManagedPreviewConfig {
  return {
    previewPort: 5181,
    apiPort: 3012,
    dbPort: 55443,
    audience: 'notes-api',
    jwksURL: 'https://localhost:8443/realms/notes/protocol/openid-connect/certs',
    caFile: '/private/tmp/notes-test-ca.pem'
  }
}

function event(): Extract<ManagedPreviewEvent, { type: 'result' }> {
  return {
    version: 1,
    type: 'result',
    id: 'request-1',
    state: {
      sessionId: SESSION,
      phase: 'prepared',
      initialized: true,
      applicationId: 'notes',
      applicationDigest: DIGEST,
      connection: null,
      plan: {
        planId: DIGEST,
        kind: 'runtime',
        fromApplicationDigest: DIGEST,
        toApplicationDigest: DIGEST,
        sql: '',
        summary: ['Runtime update only.'],
        diagnostics: [],
        requiresApproval: false
      }
    }
  }
}

describe('managed preview portable protocol', () => {
  test('round-trips normalized prepare input with the explicit local CA file exception', () => {
    const parsed = parseManagedPreviewCommand({
      version: 1,
      id: 'request-1',
      command: 'prepare',
      application: browserApplication(),
      config: config()
    })
    expect(parsed.command).toBe('prepare')
    if (parsed.command !== 'prepare') throw new Error('Unexpected command')
    expect(parsed.config.caFile).toBe('/private/tmp/notes-test-ca.pem')
    expect(parsed.application).toEqual(browserApplication())
    expect(Object.isFrozen(parsed.config)).toBe(true)
  })

  test.each(['sql', 'files', 'path', 'cwd', 'environment', 'databaseURL'])(
    'rejects caller-provided %s authority',
    (key) => {
      const input = { version: 1, id: 'request-1', command: 'start', [key]: 'untrusted' }
      expect(() => parseManagedPreviewCommand(input)).toThrow(
        'Invalid managed preview protocol data.'
      )
    }
  )

  test.each(['setup', 'apply'] as const)(
    'accepts %s only with an exact canonical plan digest',
    (command) => {
      expect(
        parseManagedPreviewCommand({ version: 1, id: 'request-1', command, planId: DIGEST })
      ).toEqual({ version: 1, id: 'request-1', command, planId: DIGEST })
      for (const planId of ['A'.repeat(42) + 'B', 'sha256:' + DIGEST, '../' + DIGEST, '']) {
        expect(() =>
          parseManagedPreviewCommand({ version: 1, id: 'request-1', command, planId })
        ).toThrow()
      }
    }
  )

  test('rejects closed-schema extras, prototype objects, symbols and getters without executing them', () => {
    let reads = 0
    const getter = { version: 1, id: 'request-1', command: 'start' }
    Object.defineProperty(getter, 'command', {
      enumerable: true,
      get: () => {
        reads++
        return 'start'
      }
    })
    expect(() => parseManagedPreviewCommand(getter)).toThrow()
    expect(reads).toBe(0)
    expect(() =>
      parseManagedPreviewCommand(
        Object.assign(Object.create({ inherited: true }), {
          version: 1,
          id: 'request-1',
          command: 'start'
        })
      )
    ).toThrow()
    expect(() =>
      parseManagedPreviewCommand({
        version: 1,
        id: 'request-1',
        command: 'start',
        [Symbol('hidden')]: true
      })
    ).toThrow()
    expect(() =>
      parseManagedPreviewCommand({ version: 2, id: 'request-1', command: 'start' })
    ).toThrow()
  })

  test.each([
    { apiPort: 5181 },
    { dbPort: 5181 },
    { previewPort: 80 },
    { apiPort: 65536 },
    { dbPort: 55443.5 },
    { apiPort: '3012' },
    { audience: '' },
    { audience: ' notes-api' },
    { audience: 'notes\napi' },
    { jwksURL: 'http://localhost/certs' },
    { jwksURL: 'https://user:secret@localhost/certs' },
    { jwksURL: 'https://localhost/certs?token=private' },
    { jwksURL: 'https://localhost/certs#fragment' },
    { jwksURL: 'https://LOCALHOST/certs' },
    { caFile: '/private/tmp/ca\n.pem' },
    { clientSecret: 'private' },
    { databaseURL: 'postgres://private' }
  ])('rejects invalid or additional public configuration %j', (change) => {
    expect(() => parseManagedPreviewConfig({ ...config(), ...change })).toThrow()
  })

  test('accepts a canonical UUID and rejects session traversal and noncanonical encodings', () => {
    expect(parseManagedPreviewSessionId(SESSION)).toBe(SESSION)
    for (const value of [
      '../' + SESSION,
      SESSION.toUpperCase(),
      '12345678-1234-4123-7123-123456789abc',
      '',
      SESSION + '\n'
    ]) {
      expect(() => parseManagedPreviewSessionId(value)).toThrow()
    }
  })

  test('round-trips valid result/progress/ready/error events', () => {
    const messages: ManagedPreviewEvent[] = [
      event(),
      { version: 1, type: 'ready', sessionId: SESSION },
      {
        version: 1,
        type: 'progress',
        id: 'request-1',
        phase: 'building',
        message: 'Building the backend.'
      },
      {
        version: 1,
        type: 'error',
        id: null,
        code: 'failed',
        message: 'Backend could not be started.',
        state: null
      }
    ]
    for (const message of messages) expect(parseManagedPreviewEvent(message)).toEqual(message)
  })

  test('rejects malformed events and nested extras or noncanonical digests', () => {
    expect(() => parseManagedPreviewEvent({ ...event(), rawOutput: 'private' })).toThrow()
    expect(() => parseManagedPreviewEvent({ ...event(), type: 'unknown' })).toThrow()
    expect(() =>
      parseManagedPreviewEvent({
        ...event(),
        state: { ...event().state, applicationDigest: 'A'.repeat(42) + 'B' }
      })
    ).toThrow()
    expect(() =>
      parseManagedPreviewEvent({ ...event(), state: { ...event().state, secret: 'private' } })
    ).toThrow()
    expect(() =>
      parseManagedPreviewEvent({
        version: 1,
        type: 'progress',
        id: 'request-1',
        phase: 'building',
        message: 'private\nlog'
      })
    ).toThrow()
    const oversized = event()
    if (!oversized.state.plan) throw new Error('Missing plan')
    expect(() =>
      parseManagedPreviewEvent({
        ...oversized,
        state: {
          ...oversized.state,
          plan: { ...oversized.state.plan, summary: Array.from({ length: 257 }, () => 'change') }
        }
      })
    ).toThrow()
  })

  test('rejects accessor array items without executing event-provided code', () => {
    const input = event()
    let reads = 0
    if (!input.state.plan) throw new Error('Missing plan')
    Object.defineProperty(input.state.plan.summary, '0', {
      enumerable: true,
      get: () => {
        reads++
        return 'untrusted'
      }
    })
    expect(() => parseManagedPreviewEvent(input)).toThrow()
    expect(reads).toBe(0)
  })

  test('rejects sparse event arrays and additional array properties', () => {
    const input = event()
    if (!input.state.plan) throw new Error('Missing plan')
    const sparse: string[] = []
    sparse.length = 1
    expect(() =>
      parseManagedPreviewEvent({
        ...input,
        state: { ...input.state, plan: { ...input.state.plan, summary: sparse } }
      })
    ).toThrow()
    const withExtra = event()
    if (!withExtra.state.plan) throw new Error('Missing plan')
    Object.assign(withExtra.state.plan.summary, { secret: 'untrusted' })
    expect(() => parseManagedPreviewEvent(withExtra)).toThrow()
  })
})
