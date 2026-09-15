import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildPreviewProject } from '@open-pencil/compiler/build'

import { businessBrowserFixture } from '../browser/helpers'

for (const target of ['react', 'vue'] as const) {
  test(`${target} video template produces a static player and a separately owned NestJS bundle`, async () => {
    const retained = process.env.OPENPENCIL_MEDIA_EXPORT_ROOT
    const root = retained ?? mkdtempSync(join(tmpdir(), 'openpencil-media-export-'))
    const fixture = await businessBrowserFixture('video-live', target)
    try {
      const result = await buildPreviewProject({
        target,
        files: fixture.files,
        artifactOwnership: fixture.output.artifactOwnership,
        outDir: join(root, target)
      })
      expect(result.staticFiles).toContain('index.html')
      expect(result.staticFiles.some((path) => path.endsWith('.js'))).toBe(true)
      expect(result.serverFiles.length).toBeGreaterThan(0)
      expect(result.staticFiles.some((path) => path.startsWith('openpencil-server/'))).toBe(false)
      const pkg = JSON.parse(String(fixture.files.get('package.json')))
      expect(pkg.dependencies['hls.js']).toBe('1.7.3')
      if (retained) {
        mkdirSync(root, { recursive: true })
        writeFileSync(
          join(root, target + '.json'),
          JSON.stringify({
            application: fixture.application,
            paths: fixture.paths
          })
        )
      }
    } finally {
      if (!retained) rmSync(root, { recursive: true, force: true })
    }
  }, 60000)
}
