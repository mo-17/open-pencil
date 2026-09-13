import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emitNestJSClient } from '#compiler/backend/nestjs/client'

import { browserApplication } from '../browser-client/helpers'

interface GeneratedClientModule {
  createNestJSClient(options: {
    baseUrl: string
    getAccessToken: () => Promise<string>
    fetch: typeof fetch
  }): {
    'notes-api': {
      list(query: { filter?: { title?: string | null } }): Promise<unknown>
    }
  }
}

async function generatedClient(source: string): Promise<GeneratedClientModule> {
  const root = mkdtempSync(join(tmpdir(), 'nestjs-sdk-query-'))
  try {
    const path = join(root, 'client.ts')
    writeFileSync(path, source)
    return (await import(path)) as GeneratedClientModule
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('generated NestJS SDK query normalization', () => {
  test('omits empty Partial filters while retaining populated and null equality filters', async () => {
    const application = browserApplication()
    if (!application.httpApi) throw new Error('Expected application HTTP API')
    application.httpApi.resources[0].query = {
      filterFields: ['title'],
      searchFields: [],
      sortFields: []
    }
    const source = emitNestJSClient(application).content
    if (typeof source !== 'string') throw new Error('Expected generated SDK source')
    const module = await generatedClient(source)
    const urls: string[] = []
    const client = module.createNestJSClient({
      baseUrl: 'https://api.example',
      getAccessToken: () => Promise.resolve('verified-token'),
      fetch: ((input: string | URL | Request) => {
        urls.push(String(input))
        return Promise.resolve(Response.json({ data: [], nextCursor: null }))
      }) as typeof fetch
    })
    await client['notes-api'].list({ filter: {} })
    await client['notes-api'].list({ filter: { title: undefined } })
    await client['notes-api'].list({ filter: { title: 'Tea' } })
    await client['notes-api'].list({ filter: { title: null } })
    expect(urls.slice(0, 2)).toEqual(['https://api.example/notes', 'https://api.example/notes'])
    expect(new URL(urls[2]).searchParams.get('filter')).toBe('{"title":"Tea"}')
    expect(new URL(urls[3]).searchParams.get('filter')).toBe('{"title":null}')
  })
})
