import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { emitNestJSPreviewContract } from '#compiler/backend/nestjs/runtime/preview-contract'

import { nestJSPreviewApplicationDigest } from '@open-pencil/compiler/backend'

import { nestJSApplication } from './helpers'

type PreviewRequest = {
  method: string
  url: string
  socket: { remoteAddress: string }
  headers: { host: string; origin?: string; 'x-forwarded-for'?: string }
}

function fixture(environment: Record<string, string> = {}, resourcePath?: string) {
  const application = nestJSApplication()
  if (resourcePath && application.httpApi) application.httpApi.resources[0].path = resourcePath
  const artifact = emitNestJSPreviewContract(application)
  const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(String(artifact.content))
  const configure = runInNewContext(
    source.replace(
      'export function configurePreviewContract',
      'function configurePreviewContract'
    ) + '\nconfigurePreviewContract',
    { process: { env: environment } }
  )
  let middleware: ((...args: unknown[]) => void) | undefined
  configure({ use: (handler: typeof middleware) => (middleware = handler) })
  return {
    application,
    artifact,
    enabled: Boolean(middleware),
    request(overrides: Partial<PreviewRequest> = {}) {
      let status = 200
      let body: unknown
      let next = false
      const headers: Record<string, string> = {}
      const response = {
        status(value: number) {
          status = value
          return response
        },
        end() {
          return response
        },
        json(value: unknown) {
          body = value
        },
        setHeader(key: string, value: string) {
          headers[key] = value
        }
      }
      middleware?.(
        {
          method: 'GET',
          url: '/_openpencil/preview-contract',
          socket: { remoteAddress: '127.0.0.1' },
          headers: { host: '127.0.0.1:3000' },
          ...overrides
        },
        response,
        () => {
          next = true
        }
      )
      return { status, body, next, headers }
    }
  }
}

describe('generated local NestJS preview contract', () => {
  test('never shadows an existing resource in the reserved metadata namespace', () => {
    for (const path of ['/_openpencil/preview-contract', '/_OpenPencil/notes', '/_openpencil']) {
      expect(fixture({ OPENPENCIL_LOCAL_PREVIEW: '1' }, path).enabled).toBe(false)
    }
    expect(fixture({ OPENPENCIL_LOCAL_PREVIEW: '1' }, '/notes/_openpencil').enabled).toBe(true)
  })
  test('is opt-in and cannot be enabled with an external listen address', () => {
    expect(fixture().enabled).toBe(false)
    expect(fixture({ OPENPENCIL_LOCAL_PREVIEW: 'true' }).enabled).toBe(false)
    expect(fixture({ OPENPENCIL_LOCAL_PREVIEW: '1', HOST: '0.0.0.0' }).enabled).toBe(false)
    expect(fixture({ NODE_ENV: 'production' }).enabled).toBe(false)
    expect(fixture({ OPENPENCIL_LOCAL_PREVIEW: '1', HOST: 'localhost' }).enabled).toBe(false)
  })

  test('publishes only the application identity and normalized compatibility digest', () => {
    const f = fixture({ OPENPENCIL_LOCAL_PREVIEW: '1' })
    const result = f.request()
    expect(result.body).toEqual({
      version: 1,
      applicationId: f.application.applicationId,
      applicationDigest: nestJSPreviewApplicationDigest(f.application)
    })
    expect(result.headers['Cache-Control']).toBe('no-store')
    expect(JSON.stringify(result.body)).not.toContain('DATABASE_URL')
    expect(f.request({ url: '/notes' }).next).toBe(true)
  })

  test('rejects browser origins, wrong hosts, non-loopback peers and nonexact requests', () => {
    const f = fixture({ OPENPENCIL_LOCAL_PREVIEW: '1' })
    for (const overrides of [
      { headers: { host: '127.0.0.1:3000', origin: 'https://example.com' } },
      { headers: { host: 'example.com:3000' } },
      { socket: { remoteAddress: '192.168.1.10' } },
      { method: 'POST' },
      { method: 'HEAD' },
      { method: 'OPTIONS' },
      { url: '/_openpencil/preview-contract?inspect=1' }
    ]) {
      expect(f.request(overrides)).toMatchObject({ status: 404, body: undefined, next: false })
    }
    expect(f.request({ socket: { remoteAddress: '::ffff:127.0.0.1' } }).status).toBe(200)
  })

  test('binds the configured port and ignores forwarded peer claims', () => {
    const f = fixture({ OPENPENCIL_LOCAL_PREVIEW: '1', HOST: '127.0.0.1', PORT: '3100' })
    expect(f.request()).toMatchObject({ status: 404, body: undefined })
    expect(f.request({ headers: { host: '127.0.0.1:3100' } }).body).toEqual({
      version: 1,
      applicationId: f.application.applicationId,
      applicationDigest: nestJSPreviewApplicationDigest(f.application)
    })
    expect(
      f.request({
        socket: { remoteAddress: '192.168.1.10' },
        headers: { host: '127.0.0.1:3100', 'x-forwarded-for': '127.0.0.1' }
      })
    ).toMatchObject({ status: 404, body: undefined, next: false })
  })
})
