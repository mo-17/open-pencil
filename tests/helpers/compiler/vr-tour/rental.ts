import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

interface RentalFixture {
  files: Map<string, string>
  apiBasePath: string
  entryPath: string
  exitPath: string
  resources: Array<{ id: string; path: string }>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Bun owns source aliases and the compiler; Node receives generated data only. */
export function generatedRentalFixture(target: 'react' | 'vue'): RentalFixture {
  const source = execFileSync(
    'bun',
    [
      '-e',
      `import { businessBrowserFixture } from './tests/engine/app/lowcode/backend/business/browser/helpers';
const fixture = await businessBrowserFixture('rental-viewing', '${target}');
process.stdout.write(JSON.stringify({ files: [...fixture.files], apiBasePath: fixture.apiBasePath,
entryPath: fixture.paths['rental-properties'], exitPath: fixture.paths['rental-viewings'],
resources: fixture.application.httpApi.resources.map(({id,path}) => ({id,path})) }));`
    ],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 }
  )
  const value: unknown = JSON.parse(source)
  if (!record(value) || !Array.isArray(value.files) || !Array.isArray(value.resources))
    throw new Error('Invalid generated rental fixture')
  const files = new Map<string, string>()
  for (const item of value.files) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'string')
      throw new Error('Expected text sources in the generated rental fixture')
    files.set(item[0], item[1])
  }
  const resources: RentalFixture['resources'] = []
  for (const resource of value.resources) {
    if (!record(resource) || typeof resource.id !== 'string' || typeof resource.path !== 'string')
      throw new Error('Invalid generated rental resource')
    resources.push({ id: resource.id, path: resource.path })
  }
  for (const key of ['apiBasePath', 'entryPath', 'exitPath'] as const)
    if (typeof value[key] !== 'string' || !value[key].startsWith('/'))
      throw new Error('Missing generated rental route: ' + key)
  return {
    files,
    resources,
    apiBasePath: String(value.apiBasePath),
    entryPath: String(value.entryPath),
    exitPath: String(value.exitPath)
  }
}

export function rentalPanoramaAssets(directory: string) {
  return ['cayley_interior.jpg', 'lebombo.jpg'].map((filename) => {
    const body = readFileSync(join(directory, filename))
    if (body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff)
      throw new Error('Real rental panorama must be JPEG: ' + filename)
    return {
      path: '/assets/vr-tour/' + filename,
      filename,
      body,
      sha256: createHash('sha256').update(body).digest('hex')
    }
  })
}

const propertyFields = {
  city: 'Cape Town',
  district: 'Real house panorama fixture',
  address: 'Fixture address for the viewer test',
  rent_monthly_cents: 300000,
  room_layout: 'Interior',
  area_sqm_x100: 8000,
  description: 'Real photographic equirectangular panorama; fixture listing metadata.',
  cover_image_url: '',
  status: 'published',
  version: 0,
  created_at: '2026-09-15T00:00:00.000000Z'
}

/** Only API reads are scripted. Viewer images are the actual local JPEG bytes. */
export async function installRentalPanoramaRoutes(
  page: Page,
  fixture: RentalFixture,
  serverURL: string,
  assets: ReturnType<typeof rentalPanoramaAssets>
) {
  const origin = new URL(serverURL).origin
  const properties = assets.map((asset, index) => ({
    ...propertyFields,
    id: `00000000-0000-4000-8000-00000000002${index}`,
    title: index === 0 ? 'Cayley interior home' : 'Lebombo home',
    panorama_url: asset.path
  }))
  const images: Array<{ path: string; method: string; referer?: string; cookie?: string }> = []
  const reads: string[] = []
  const failures: string[] = []
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) {
      failures.push('Unexpected external request: ' + url.origin + url.pathname)
      return route.abort('blockedbyclient')
    }
    const asset = assets.find((item) => item.path === url.pathname)
    if (asset) {
      const headers = request.headers()
      images.push({
        path: url.pathname,
        method: request.method(),
        referer: headers.referer,
        cookie: headers.cookie
      })
      return route.fulfill({ contentType: 'image/jpeg', body: asset.body })
    }
    if (!url.pathname.startsWith(fixture.apiBasePath + '/')) return route.continue()
    const path = url.pathname.slice(fixture.apiBasePath.length)
    const resource = fixture.resources.find(
      (item) => path === item.path || path.startsWith(item.path + '/')
    )
    if (request.method() !== 'GET' || !resource) {
      failures.push('Unexpected backend request: ' + request.method() + ' ' + path)
      return route.fulfill({ status: 500, json: { message: 'Unexpected rental fixture request' } })
    }
    reads.push(path)
    const rows = resource.id === 'rental-properties' ? properties : []
    if (path === resource.path) return route.fulfill({ json: { data: rows, nextCursor: null } })
    const selected = rows.find((item) => path === resource.path + '/' + item.id)
    return selected
      ? route.fulfill({ json: selected })
      : route.fulfill({ status: 404, json: { message: 'Fixture record not found' } })
  })
  return { properties, images, reads, failures }
}
