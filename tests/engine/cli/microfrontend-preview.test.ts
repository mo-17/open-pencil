import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createMicrofrontendPreviewHandler,
  parseMicrofrontendPreviewBase
} from '#cli/commands/microfrontend'

const directories: string[] = []

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'op-mfe-preview-'))
  directories.push(directory)
  mkdirSync(join(directory, 'assets'), { recursive: true })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Preview</title>')
  writeFileSync(join(directory, 'assets/app.js'), 'export const preview = true')
  writeFileSync(
    join(directory, 'openpencil.composition.json'),
    JSON.stringify({
      format: 'openpencil-microfrontend-composition',
      schemaVersion: 1,
      abi: 'openpencil.microfrontend.v1',
      composition: { id: 'preview-shell', name: 'Preview Shell', version: '1.0.0' },
      slots: [{ id: 'main' }],
      apps: [
        {
          appId: 'preview-app',
          manifest: {
            kind: 'remote',
            url: 'https://cdn.acme.dev/preview/openpencil.microfrontend.json',
            digest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            byteLength: 128
          },
          routeBase: '/',
          slotId: 'main'
        }
      ]
    })
  )
  return directory
}

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
})

describe('microfrontend composition preview', () => {
  test('serves GET/HEAD static files and an HTML-only SPA fallback under a base path', async () => {
    const handler = await createMicrofrontendPreviewHandler({
      directory: fixture(),
      base: '/suite/'
    })

    const asset = await handler(new Request('http://127.0.0.1:4173/suite/assets/app.js'))
    expect(asset.status).toBe(200)
    expect(await asset.text()).toContain('preview = true')
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(asset.headers.get('cache-control')).toBe('no-store')
    expect(asset.headers.get('x-content-type-options')).toBe('nosniff')

    const head = await handler(
      new Request('http://127.0.0.1:4173/suite/assets/app.js', { method: 'HEAD' })
    )
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    const deepRoute = await handler(
      new Request('http://127.0.0.1:4173/suite/orders/detail', {
        headers: { accept: 'text/html' }
      })
    )
    expect(deepRoute.status).toBe(200)
    expect(await deepRoute.text()).toContain('<title>Preview</title>')

    expect((await handler(new Request('http://127.0.0.1:4173/outside'))).status).toBe(404)
    const redirect = await handler(new Request('http://127.0.0.1:4173/suite'))
    expect(redirect.status).toBe(308)
    expect(redirect.headers.get('location')).toBe('http://127.0.0.1:4173/suite/')
    expect(redirect.headers.get('cache-control')).toBe('no-store')
    expect(redirect.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await handler(new Request('http://127.0.0.1:4173/suite/missing.js'))).status).toBe(404)
    expect(
      (await handler(new Request('http://127.0.0.1:4173/suite/assets/app.js', { method: 'POST' })))
        .status
    ).toBe(405)
  })

  test('strictly validates the composition before serving and refuses symlinks', async () => {
    const directory = fixture()
    symlinkSync(join(directory, 'assets/app.js'), join(directory, 'linked.js'))
    const handler = await createMicrofrontendPreviewHandler({ directory })
    const linked = await handler(new Request('http://127.0.0.1:4173/linked.js'))
    expect(linked.status).toBe(403)

    writeFileSync(join(directory, 'openpencil.composition.json'), '{}')
    await expect(createMicrofrontendPreviewHandler({ directory })).rejects.toThrow(
      'microfrontendComposition.format is required'
    )
  })

  test('accepts only canonical root base paths', () => {
    expect(parseMicrofrontendPreviewBase('/')).toBe('/')
    expect(parseMicrofrontendPreviewBase('/suite/')).toBe('/suite/')
    for (const value of [
      'suite/',
      '/suite',
      '//suite/',
      '/suite//nested/',
      '/suite/../root/',
      '/suite/%2e/'
    ]) {
      expect(() => parseMicrofrontendPreviewBase(value), value).toThrow()
    }
  })
})
