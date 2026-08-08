import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAPLIBRE_GL_VERSION } from '@open-pencil/compiler/adapters/react/map/component'
import { previewOptimizeDeps } from '@open-pencil/compiler/dev-server'

/**
 * The preview VFS serves generated source without installing its emitted
 * package.json. A generated map therefore resolves MapLibre from the preview
 * host workspace dependency, just like the other on-demand preview runtimes.
 */
describe('preview can resolve maplibre-gl', () => {
  test('preview host declares the same MapLibre version generated projects use', () => {
    const pkgPath = join(process.cwd(), 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared = pkg.devDependencies?.['maplibre-gl'] ?? pkg.dependencies?.['maplibre-gl']

    expect(declared).toBe(MAPLIBRE_GL_VERSION)
  })

  test('maplibre-gl ESM exports resolve from the monorepo', async () => {
    const maplibre = await import('maplibre-gl')

    expect(typeof maplibre.Map).toBe('function')
    expect(typeof maplibre.Marker).toBe('function')
  })

  test('prebundles MapLibre only when the generated map runtime is in the VFS', () => {
    const ordinaryFiles = new Map<string, string | Uint8Array>([
      ['src/App.tsx', 'export default 1']
    ])
    const mapFiles = new Map(ordinaryFiles)
    mapFiles.set('src/__openpencil_map.tsx', 'export default 1')

    expect(previewOptimizeDeps(ordinaryFiles)).not.toContain('maplibre-gl')
    expect(previewOptimizeDeps(mapFiles)).toContain('maplibre-gl')
  })
})
