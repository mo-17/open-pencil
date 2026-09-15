import { expect, test } from 'bun:test'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Connect } from 'vite'

import {
  contentTypeForPath,
  inMemoryVFS,
  lookupFile,
  type PreviewFiles
} from '@open-pencil/compiler/vfs'

const PREFIX = '/scan-root/'
const ASSET = 'assets/vr-tour/residence.jpg'
const BYTES = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9])

type Generate = (
  this: { emitFile: (asset: unknown) => void },
  options: unknown,
  bundle: object
) => void
type Configure = (server: {
  middlewares: { use: (handler: Connect.NextHandleFunction) => void }
}) => void

test('public binary files retain nested paths in imported URL modules and build output', () => {
  const files: PreviewFiles = new Map([['public/' + ASSET, BYTES]])
  const plugin = inMemoryVFS({ files }, PREFIX)
  expect(lookupFile(files, ASSET)).toBe('public/' + ASSET)
  const resolve = plugin.resolveId as (source: string) => string | null
  const load = plugin.load as (id: string) => string | null
  expect(resolve('/' + ASSET)).toBe(PREFIX + 'public/' + ASSET)
  expect(load(PREFIX + 'public/' + ASSET)).toBe(
    `export default import.meta.env.BASE_URL + ${JSON.stringify(ASSET)}\n`
  )
  const emitted: unknown[] = []
  const generate = plugin.generateBundle as Generate
  generate.call({ emitFile: (asset) => emitted.push(asset) }, {}, {})
  expect(emitted).toEqual([{ type: 'asset', fileName: ASSET, source: BYTES }])
})

function request(files: PreviewFiles, url: string) {
  const plugin = inMemoryVFS({ files }, PREFIX)
  const handlers: Connect.NextHandleFunction[] = []
  const configure = plugin.configureServer as Configure
  configure({ middlewares: { use: (handler) => handlers.push(handler) } })
  const headers = new Map<string, string>()
  let body: unknown
  let passed = false
  const response = {
    statusCode: 0,
    setHeader: (name: string, value: string) => headers.set(name, value),
    end: (value: unknown) => {
      body = value
    }
  }
  handlers[0]({ url } as IncomingMessage, response as ServerResponse, () => {
    passed = true
  })
  return { headers, body, passed, status: response.statusCode }
}

test('dev middleware serves the nested public URL with the original bytes and image MIME', () => {
  expect(contentTypeForPath('public/assets/vr-tour/SOURCES.json')).toBe('application/json')
  const files: PreviewFiles = new Map([['public/' + ASSET, BYTES]])
  const response = request(files, '/' + ASSET + '?v=1')
  expect(response.passed).toBe(false)
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('image/jpeg')
  expect(response.headers.get('Content-Length')).toBe(String(BYTES.byteLength))
  expect(new Uint8Array(response.body as Uint8Array)).toEqual(BYTES)
  expect(request(files, '/assets/residence.jpg').passed).toBe(true)
})

test.each([
  '../secret.jpg',
  'assets/../secret.jpg',
  'assets//secret.jpg',
  'assets/%2e%2e/secret.jpg',
  'assets/secret.jpg#x',
  'assets\\secret.jpg',
  '/assets/secret.jpg'
])('public paths do not normalize unsafe aliases: %s', (path) => {
  const files: PreviewFiles = new Map([['public/' + path, BYTES]])
  expect(lookupFile(files, path)).toBeNull()
  expect(request(files, '/' + path).passed).toBe(true)
  const generate = inMemoryVFS({ files }, PREFIX).generateBundle as Generate
  expect(() => generate.call({ emitFile: () => undefined }, {}, {})).toThrow(
    'Invalid public asset path'
  )
})
