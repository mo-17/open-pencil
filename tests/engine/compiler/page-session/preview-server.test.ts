import { describe, expect, test } from 'bun:test'

import { APPLICATION_SESSION_FILE } from '#compiler/adapters/application-session/runtime'
import { createPreviewServer } from '#compiler/dev-server'

import { compileApplicationSessionFixture } from '#tests/helpers/compiler/application-session/fixture'

const DEEP_ROUTE = '/products/42?view=draft'
const HTML = { accept: 'text/html' }

for (const target of ['react', 'vue'] as const) {
  describe(`${target} explicit application session preview routing`, () => {
    test.each(['preserve', 'reset'] as const)(
      '%s serves the current HTML entry on the first deep route navigation',
      async (retention) => {
        const output = compileApplicationSessionFixture(target, retention)
        expect(output.warnings).toEqual([])
        expect(output.files.has(APPLICATION_SESSION_FILE)).toBe(true)
        const server = await createPreviewServer({ target, initialFiles: output.files })
        try {
          const response = await fetch(new URL(DEEP_ROUTE, server.url), { headers: HTML })
          expect(response.status).toBe(200)
          expect(response.headers.get('content-type')).toBe('text/html')
          expect(await response.text()).toContain('/src/main.')
        } finally {
          await server.close()
        }
      },
      30000
    )

    test('enables and revokes fallback from the current VFS without bypassing request gates', async () => {
      const output = compileApplicationSessionFixture(target)
      expect(output.warnings).toEqual([])
      const server = await createPreviewServer({ target })
      try {
        const route = new URL(DEEP_ROUTE, server.url)
        const empty = await fetch(route, { headers: HTML })
        expect(empty.status).toBe(404)
        await empty.text()

        await server.updateFiles(output.files)
        const active = await fetch(route, { headers: HTML })
        expect(active.status).toBe(200)
        expect(await active.text()).toContain('/src/main.')
        const head = await fetch(route, { method: 'HEAD', headers: HTML })
        expect(head.status).toBe(200)
        expect(await head.text()).toBe('')

        for (const [path, options] of [
          [DEEP_ROUTE, { headers: { accept: 'application/json' } }],
          [DEEP_ROUTE, { method: 'POST', headers: HTML }],
          ['/src/not-a-module.ts', { headers: HTML }],
          ['/assets/not-an-asset.png', { headers: HTML }],
          ['/node_modules/not-a-package', { headers: HTML }],
          ['/@not-a-runtime', { headers: HTML }],
          ['/products/42.json?view=draft', { headers: HTML }]
        ] satisfies Array<[string, RequestInit]>) {
          const rejected = await fetch(new URL(path, server.url), options)
          expect(rejected.status).toBe(404)
          expect(await rejected.text()).not.toContain('/src/main.')
        }

        const featureless = new Map(output.files)
        featureless.delete(APPLICATION_SESSION_FILE)
        await server.updateFiles(featureless)
        const revoked = await fetch(route, { headers: HTML })
        expect(revoked.status).toBe(404)
        expect(await revoked.text()).not.toContain('/src/main.')
        const root = await fetch(server.url, { headers: HTML })
        expect(root.status).toBe(200)
        expect(await root.text()).toContain('/src/main.')
      } finally {
        await server.close()
      }
    }, 30000)
  })
}
