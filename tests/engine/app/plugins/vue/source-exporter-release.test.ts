import { describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { unzipSync, zipSync, type Zippable } from 'fflate'

import { compile } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  exportCurrentDocumentAsVueSource,
  type VueSourceExporterDependencies
} from '@/app/plugins/host/vue/source-exporter'

const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4])

function archiveReleaseFiles(files: ReadonlyMap<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder()
  const entries = Object.create(null) as Zippable
  for (const [path, content] of files) {
    entries[path] = typeof content === 'string' ? encoder.encode(content) : content
  }
  return zipSync(entries, { level: 6 })
}

function writeArchive(directory: string, archive: Uint8Array): Record<string, Uint8Array> {
  const files = unzipSync(archive)
  for (const [path, content] of Object.entries(files)) {
    const destination = join(directory, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, content)
  }
  return files
}

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

function containsExactBytes(directory: string, expected: Uint8Array): boolean {
  return filesBelow(directory).some((path) => {
    const actual = readFileSync(path)
    return (
      actual.byteLength === expected.byteLength &&
      actual.every((byte, index) => byte === expected[index])
    )
  })
}

describe('Vue source project release archive', () => {
  test('builds a fresh unzipped project and preserves reviewed font and image bytes', async () => {
    const graph = new SceneGraph()
    const [page] = graph.getPages()
    graph.images.set('release-image', IMAGE)
    graph.createNode('RECTANGLE', page.id, {
      name: 'Release image',
      width: 320,
      height: 180,
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'release-image',
          imageScaleMode: 'FILL',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    graph.createNode('TEXT', page.id, {
      name: 'Release text',
      text: 'Reviewed font asset',
      fontFamily: 'Inter',
      fontWeight: 400
    })
    const font = new Uint8Array(
      await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    )
    let archive: Uint8Array | undefined
    const dependencies: VueSourceExporterDependencies = {
      async chooseDestination() {
        return {
          async write(value) {
            archive = value
          }
        }
      },
      async resolveFontManifest() {
        return {
          faces: [
            {
              family: 'Inter',
              weight: 400,
              style: 'normal',
              format: 'truetype',
              path: 'src/assets/fonts/inter-regular.ttf',
              content: font
            }
          ]
        }
      },
      compile,
      async archive(files) {
        return archiveReleaseFiles(files)
      }
    }

    const result = await exportCurrentDocumentAsVueSource(
      { graph, state: { documentName: 'Vue Release' } },
      dependencies
    )
    if (!archive) throw new Error('Vue exporter did not write an archive')

    const directory = mkdtempSync(join(tmpdir(), 'openpencil-vue-release-'))
    try {
      const files = writeArchive(directory, archive)
      const packageJSON = JSON.parse(new TextDecoder().decode(files['package.json'])) as {
        scripts: Record<string, string>
        dependencies: Record<string, string>
        devDependencies: Record<string, string>
      }
      expect(packageJSON.scripts.build).toBe('vue-tsc --noEmit && vite build')
      expect(packageJSON.dependencies.vue).toBeDefined()
      for (const dependency of [
        '@tailwindcss/vite',
        '@vitejs/plugin-vue',
        'tailwindcss',
        'typescript',
        'vite',
        'vue-tsc'
      ]) {
        expect(packageJSON.devDependencies[dependency]).toBeDefined()
      }
      expect(files['src/assets/fonts/inter-regular.ttf']).toEqual(font)
      expect(files['src/assets/openpencil-image-release-image.png']).toEqual(IMAGE)
      const notice = new TextDecoder().decode(files['FONT-LICENSES.txt'])
      expect(notice).toContain('Copyright (c) 2016 The Inter Project Authors')
      expect(notice).toContain('SIL OPEN FONT LICENSE Version 1.1')
      expect(result.warnings.map(({ code }) => code)).not.toContain('vue-font-assets-omitted')

      symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'junction')
      const build = Bun.spawnSync({
        cmd: ['bun', 'run', 'build'],
        cwd: directory,
        stdout: 'pipe',
        stderr: 'pipe'
      })
      const diagnostics = `${build.stdout.toString()}${build.stderr.toString()}`
      expect(build.exitCode, diagnostics).toBe(0)
      expect(containsExactBytes(join(directory, 'dist/assets'), font)).toBe(true)
      expect(containsExactBytes(join(directory, 'dist/assets'), IMAGE)).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
