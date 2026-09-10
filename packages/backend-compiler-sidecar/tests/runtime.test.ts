/* oxlint-disable max-lines -- Protocol, pure runtime, and process boundaries share one fixture. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  parseSupabaseBackfillInspectionWireRequestV1,
  parseSupabaseBackfillInspectionWireResponseV1,
  serializeSupabaseBackfillInspectionWireRequestV1,
  SUPABASE_BACKFILL_COMPILER_TRUST_SELECTION_DIGEST_V1,
  type SupabaseBackfillInspectionWireRequestV1
} from '@open-pencil/compiler/backend'

import {
  handleBackendCompilerSidecarInput,
  readBackendCompilerSidecarFrame,
  serializeBackendCompilerSidecarInput
} from '../src/index'
import {
  BACKEND_COMPILER_SIDECAR_LIMITS,
  BackendCompilerSidecarError,
  canonicalBackendCompilerSidecarJSON
} from '../src/protocol'
import { createSupabaseBackfillInspectionFromWire } from '../src/runtime'

const REQUEST_NONCE = 'A'.repeat(43)

interface MutableWireRequest {
  [key: string]: unknown
  application: unknown
  requestNonce: unknown
  target: unknown
  version: unknown
}

interface ProcessResponseShape {
  [key: string]: unknown
  ok: unknown
  requestNonce: unknown
  version: unknown
}

interface NativeCompilerSidecarFixtureV1 {
  readonly fixtureFormat: 'openpencil.test.backend.supabase.backfill-compiler-sidecar.v1'
  readonly fixtureVersion: 1
  readonly request: SupabaseBackfillInspectionWireRequestV1
  readonly requestDigest: string
  readonly response: unknown
}

function backfillApplication(): SupabaseBackfillInspectionWireRequestV1['application'] {
  return {
    format: 'openpencil.backend-application',
    version: 2,
    applicationId: 'test.supabase-sidecar-backfill',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'accounts',
          name: 'accounts',
          management: 'managed',
          fields: [
            {
              id: 'account-id',
              name: 'id',
              type: 'integer',
              nullable: false,
              default: { kind: 'generated', generator: 'identity' }
            },
            {
              id: 'account-status',
              name: 'status',
              type: 'string',
              nullable: false,
              default: { kind: 'literal', value: 'pending' }
            }
          ],
          primaryKey: { fields: ['account-id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    realtime: { version: 1, subscriptions: [] },
    transactions: { version: 1, transactions: [] },
    dataMigrations: {
      version: 1,
      migrations: [
        {
          id: 'backfill-account-status',
          name: 'Backfill account status',
          entityId: 'accounts',
          cursor: { kind: 'monotonic-identity-primary-key', fieldId: 'account-id' },
          batchSize: 250,
          predicate: { kind: 'field-is-null', fieldId: 'account-status' },
          transforms: [{ kind: 'set-literal', fieldId: 'account-status', value: 'pending' }],
          postconditions: [
            { kind: 'field-not-null', fieldId: 'account-status' },
            { kind: 'matched-row-count', minimum: 1 }
          ],
          dryRunRequired: true,
          resumePolicy: 'from-receipt'
        }
      ]
    },
    automations: {
      version: 1,
      queues: [],
      webhookDestinations: [],
      automations: [],
      telemetry: { logs: false, metrics: false, traces: false, auditEvents: false },
      driftDetection: { enabled: false }
    },
    capabilities: [
      { capability: 'migrations.backfill', required: true },
      { capability: 'migrations.data', required: true },
      { capability: 'migrations.schema', required: true }
    ],
    secrets: []
  }
}

function requestJSON(target: SupabaseBackfillInspectionWireRequestV1['target'] = 'react'): string {
  return serializeSupabaseBackfillInspectionWireRequestV1({
    version: 1,
    requestNonce: REQUEST_NONCE,
    target,
    application: backfillApplication()
  })
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
}

function encoded(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected promise to reject')
}

function mutatedRequest(mutate: (request: MutableWireRequest) => void): string {
  const request = JSON.parse(requestJSON()) as MutableWireRequest
  mutate(request)
  return canonicalBackendCompilerSidecarJSON(request)
}

describe('Backend Compiler sidecar runtime', () => {
  test('matches the checked-in native request and two-envelope response golden', () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          '../../../tests/fixtures/backend/supabase/backfill-compiler-sidecar-v1.json',
          import.meta.url
        ),
        'utf8'
      )
    ) as NativeCompilerSidecarFixtureV1
    expect(fixture.fixtureFormat).toBe(
      'openpencil.test.backend.supabase.backfill-compiler-sidecar.v1'
    )
    expect(fixture.fixtureVersion).toBe(1)
    const requestFrame = serializeSupabaseBackfillInspectionWireRequestV1(fixture.request)
    expect(requestFrame).toBe(canonicalBackendCompilerSidecarJSON(fixture.request))
    expect(parseSupabaseBackfillInspectionWireRequestV1(requestFrame).requestDigest).toBe(
      fixture.requestDigest
    )
    expect(serializeBackendCompilerSidecarInput(requestFrame)).toBe(
      canonicalBackendCompilerSidecarJSON(fixture.response)
    )
  })

  test('derives one review-only inspection response from the fixed Compiler trust domain', () => {
    const first = handleBackendCompilerSidecarInput(requestJSON())
    const second = handleBackendCompilerSidecarInput(requestJSON())

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      version: 1,
      requestNonce: REQUEST_NONCE,
      ok: true,
      result: {
        version: 1,
        requestNonce: REQUEST_NONCE,
        compilerBuildAuthority: {
          format: 'openpencil.supabase-backfill-compiler-build-authority.v1',
          networkAuthorityCreated: false,
          credentialAuthorityCreated: false,
          sqlExecutionAuthorityCreated: false,
          appBundleAuthorityCreated: false,
          installAuthorityCreated: false,
          executionAuthorityCreated: false,
          releaseAuthorityCreated: false
        },
        subjectEnvelope: {
          subject: {
            providerId: 'supabase',
            reviewOnly: true,
            applyAvailable: false,
            releaseReady: false,
            executionAuthorityCreated: false,
            plan: { target: 'react', mode: 'production' }
          }
        }
      }
    })
    if (!first.ok) throw new Error('expected success')
    const expected = parseSupabaseBackfillInspectionWireRequestV1(requestJSON())
    const parsed = parseSupabaseBackfillInspectionWireResponseV1(
      canonicalBackendCompilerSidecarJSON(first.result),
      expected
    )
    expect(parsed).toEqual(first.result)
    expect(first.result.subjectEnvelope.subject.providerAuthority.packageDigest).toBe(
      SUPABASE_BACKFILL_COMPILER_TRUST_SELECTION_DIGEST_V1
    )
  })

  test('accepts Vue only as a target while keeping production mode internal', () => {
    const response = handleBackendCompilerSidecarInput(requestJSON('vue'))
    expect(response).toMatchObject({
      ok: true,
      result: { subjectEnvelope: { subject: { plan: { target: 'vue', mode: 'production' } } } }
    })
  })

  test('rejects every caller-supplied authority or execution field without echoing it', () => {
    for (const key of [
      'plan',
      'selection',
      'mode',
      'packageDigest',
      'emission',
      'envelope',
      'sql',
      'url',
      'credential'
    ]) {
      const response = handleBackendCompilerSidecarInput(
        mutatedRequest((request) => {
          request[key] = `attacker-${key}`
        })
      )
      expect(response).toEqual({
        version: 1,
        requestNonce: null,
        ok: false,
        error: { code: 'invalid-request' }
      })
      expect(canonicalBackendCompilerSidecarJSON(response)).not.toContain(`attacker-${key}`)
    }
  })

  test('does not echo a nonce until the complete canonical request passes parsing', () => {
    const noncanonical = ` ${requestJSON()}`
    const malformed = `{"requestNonce":"${REQUEST_NONCE}"`
    for (const input of [noncanonical, malformed]) {
      const response = handleBackendCompilerSidecarInput(input)
      expect(response).toEqual({
        version: 1,
        requestNonce: null,
        ok: false,
        error: { code: 'invalid-request' }
      })
      expect(canonicalBackendCompilerSidecarJSON(response)).not.toContain(REQUEST_NONCE)
    }
  })

  test('rejects unpaired UTF-16 surrogates before returning a native-incompatible success', () => {
    for (const invalid of ['\ud800', '\ud800A', '\udc00']) {
      const malformed = JSON.parse(requestJSON()) as MutableWireRequest
      const application = malformed.application as {
        dataMigrations: { migrations: Array<{ name: string }> }
      }
      application.dataMigrations.migrations[0].name = invalid
      const input = canonicalBackendCompilerSidecarJSON(malformed)

      expect(handleBackendCompilerSidecarInput(input)).toEqual({
        version: 1,
        requestNonce: null,
        ok: false,
        error: { code: 'invalid-request' }
      })
    }
  })

  test('returns a static planner failure and does not serialize diagnostics', () => {
    const response = handleBackendCompilerSidecarInput(
      mutatedRequest((request) => {
        const application = request.application as {
          dataModel: {
            entities: Array<Record<string, unknown>>
          }
        }
        application.dataModel.entities.push({
          id: 'secondary',
          name: 'secondary',
          management: 'managed',
          fields: [
            {
              id: 'secondary-id',
              name: 'id',
              type: 'integer',
              nullable: false,
              default: { kind: 'generated', generator: 'identity' }
            }
          ],
          primaryKey: { fields: ['secondary-id'] }
        })
      })
    )
    expect(response).toEqual({
      version: 1,
      requestNonce: REQUEST_NONCE,
      ok: false,
      error: { code: 'plan-rejected' }
    })
  })

  test('accepts only raw canonical text without dereferencing accessor or proxy inputs', () => {
    let getterCalls = 0
    const accessorInput = Object.create(null) as MutableWireRequest
    Object.defineProperty(accessorInput, 'request', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return { application: backfillApplication() }
      }
    })
    const proxyInput = new Proxy(accessorInput, {
      get() {
        getterCalls += 1
        return undefined
      },
      getPrototypeOf() {
        getterCalls += 1
        return null
      }
    })

    expect(() => createSupabaseBackfillInspectionFromWire(accessorInput as never)).toThrow(
      new BackendCompilerSidecarError('invalid-request')
    )
    expect(() => createSupabaseBackfillInspectionFromWire(proxyInput as never)).toThrow(
      new BackendCompilerSidecarError('invalid-request')
    )
    expect(getterCalls).toBe(0)
  })

  test('uses only the validated request nonce when an injected result cannot serialize', () => {
    let getterCalls = 0
    const hostileResult = Object.create(null)
    Object.defineProperty(hostileResult, 'requestNonce', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        throw new Error('must not execute')
      }
    })

    const output = serializeBackendCompilerSidecarInput(requestJSON(), () => hostileResult as never)
    expect(JSON.parse(output)).toEqual({
      error: { code: 'response-limit' },
      ok: false,
      requestNonce: REQUEST_NONCE,
      version: 1
    })
    expect(getterCalls).toBe(0)
  })

  test('contains no ambient authority imports or calls in the pure runtime', () => {
    const source = readFileSync(new URL('../src/runtime.ts', import.meta.url), 'utf8')
    for (const forbidden of [
      'node:fs',
      'node:child_process',
      'Bun.spawn',
      'Bun.file',
      'fetch(',
      'process.env',
      'Deno.env',
      'WebSocket'
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})

describe('Backend Compiler sidecar framing', () => {
  test('accepts exactly one non-empty LF-terminated UTF-8 frame', async () => {
    expect(await readBackendCompilerSidecarFrame(stream(encoded(`${requestJSON()}\n`)))).toBe(
      requestJSON()
    )
  })

  test('rejects missing LF, CRLF, multiple frames, invalid UTF-8, and oversized input', async () => {
    const cases = [
      [encoded('{}'), 'incomplete-frame'],
      [encoded('{}\r\n'), 'invalid-frame'],
      [encoded('{}\n{}\n'), 'invalid-frame'],
      [new Uint8Array([0xff, 0x0a]), 'invalid-utf8'],
      [
        encoded(`${'a'.repeat(BACKEND_COMPILER_SIDECAR_LIMITS.maxStdinBytes + 1)}\n`),
        'request-limit'
      ]
    ] as const
    for (const [input, code] of cases) {
      expect(await rejected(readBackendCompilerSidecarFrame(stream(input)))).toMatchObject({ code })
    }
  })

  test('writes one canonical response line with empty stderr in a real process', async () => {
    const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
    const child = Bun.spawn([process.execPath, entry], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe'
    })
    await child.stdin.write(`${requestJSON()}\n`)
    await child.stdin.end()
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])
    expect(status).toBe(0)
    expect(stderr).toBe('')
    expect(stdout.endsWith('\n')).toBe(true)
    expect(stdout.indexOf('\n')).toBe(stdout.length - 1)
    const response = JSON.parse(stdout) as ProcessResponseShape
    expect(response).toMatchObject({ version: 1, requestNonce: REQUEST_NONCE, ok: true })
    expect(stdout).toBe(`${canonicalBackendCompilerSidecarJSON(response)}\n`)
  })

  test('rejects arguments without reading stdin and keeps stderr empty', async () => {
    const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
    const child = Bun.spawn([process.execPath, entry, '--forbidden'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])
    expect(status).toBe(1)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      error: { code: 'arguments-forbidden' },
      ok: false,
      requestNonce: null,
      version: 1
    })
  })
})
