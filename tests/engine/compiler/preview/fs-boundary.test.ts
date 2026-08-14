import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  createPreviewServer,
  isForbiddenPreviewFileRequest,
  previewFileSystemAllowlist,
  type PreviewServer
} from '@open-pencil/compiler/dev-server'

describe('preview dev-server filesystem boundary', () => {
  let server: PreviewServer | null = null

  afterEach(async () => {
    await server?.close()
    server = null
  })

  test('allows only the preview root and installed dependency roots', () => {
    const workspaceRoot = '/workspace'
    const scanRoot = '/workspace/packages/compiler/.preview-root/react'
    expect(previewFileSystemAllowlist(workspaceRoot, scanRoot)).toEqual([
      scanRoot,
      '/workspace/node_modules',
      '/workspace/packages/compiler/node_modules'
    ])
  })

  test('leaves filesystem enforcement to Vite while rejecting workspace packages', () => {
    expect(isForbiddenPreviewFileRequest('/@fs/workspace/package.json')).toBe(false)
    expect(isForbiddenPreviewFileRequest('/%40fs%2Fworkspace%2Fpackage.json')).toBe(false)
    expect(isForbiddenPreviewFileRequest('/%40fs%5Cworkspace%5Cpackage.json')).toBe(false)
    expect(isForbiddenPreviewFileRequest('/node_modules/@open-pencil/core/package.json')).toBe(true)
    expect(isForbiddenPreviewFileRequest('/@id/%40open-pencil%2Fcompiler')).toBe(true)
    expect(isForbiddenPreviewFileRequest('/@id/__x00__%40open-pencil%2Fcompiler')).toBe(true)
    expect(isForbiddenPreviewFileRequest('/src/main.tsx')).toBe(false)
    expect(isForbiddenPreviewFileRequest('/node_modules/.vite/deps/react.js?v=1')).toBe(false)
  })

  test('serves Vite dependencies while rejecting direct and symlinked workspace access', async () => {
    const workspaceRoot = process.cwd()
    server = await createPreviewServer({ fsRoot: workspaceRoot })
    const workspacePackage = join(workspaceRoot, 'package.json')
    const optimizedReact = join(workspaceRoot, 'packages/compiler/node_modules/.vite/deps/react.js')
    const serverURL = server.url
    const viteFileURL = (path: string): string =>
      new URL(`/@fs${pathToFileURL(path).pathname}`, serverURL).href
    const dependencyResponse = await fetch(viteFileURL(optimizedReact))
    const directResponse = await fetch(viteFileURL(workspacePackage))
    const binSymlinkResponse = await fetch(
      `${server.url}@fs${workspaceRoot}/node_modules/.bin/openpencil?raw`
    )
    const symlinkResponse = await fetch(
      `${server.url}node_modules/@open-pencil/compiler/src/dev-server.ts`
    )
    const moduleIdResponse = await fetch(`${server.url}@id/@open-pencil/compiler/src/dev-server.ts`)

    expect(dependencyResponse.status).toBe(200)
    expect(directResponse.status).toBe(403)
    for (const response of [
      directResponse,
      binSymlinkResponse,
      symlinkResponse,
      moduleIdResponse
    ]) {
      expect(response.status).toBe(403)
      expect(await response.text()).toBe('Preview filesystem access is forbidden')
    }
  }, 15_000)
})
