import { expect, test } from '@playwright/test'

import type { CompilerInput, CompilerOutput } from '@open-pencil/compiler'
import type { SceneGraph as SceneGraphInstance } from '@open-pencil/scene-graph'

interface SceneGraphRuntimeModule {
  SceneGraph: new () => SceneGraphInstance
}

interface VueCompilerRuntimeModule {
  compileVueSourceProjectInWorker: (
    input: CompilerInput,
    signal?: AbortSignal
  ) => Promise<CompilerOutput>
}

interface VueArchiveRuntimeModule {
  archiveVueSourceProjectInWorker: (
    files: ReadonlyMap<string, string | Uint8Array>,
    signal?: AbortSignal
  ) => Promise<Uint8Array>
}

test('compiles Vue in a real module Worker and terminates it on abort', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const NativeWorker = window.Worker
    let terminations = 0
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: class TrackedWorker extends NativeWorker {
        override terminate(): void {
          terminations += 1
          super.terminate()
        }
      }
    })

    try {
      const importViteRuntimeModule = async <T>(absolutePath: string): Promise<T> => {
        const moduleURL = new URL(absolutePath, window.location.origin).href
        return import(/* @vite-ignore */ moduleURL) as Promise<T>
      }
      const [
        { SceneGraph },
        { compileVueSourceProjectInWorker },
        { archiveVueSourceProjectInWorker }
      ] = await Promise.all([
        importViteRuntimeModule<SceneGraphRuntimeModule>('/packages/scene-graph/src/index.ts'),
        importViteRuntimeModule<VueCompilerRuntimeModule>(
          '/src/app/plugins/host/vue/compiler/client.ts'
        ),
        importViteRuntimeModule<VueArchiveRuntimeModule>(
          '/src/app/plugins/host/vue/archive/client.ts'
        )
      ])
      const graph = new SceneGraph()
      const [designPage] = graph.getPages()
      const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4])
      const font = new Uint8Array(
        await fetch('/packages/core/assets/Inter-Regular.ttf').then((response) =>
          response.arrayBuffer()
        )
      )
      graph.images.set('hero-image', image)
      graph.createNode('RECTANGLE', designPage.id, {
        name: 'Hero',
        width: 320,
        height: 180,
        fills: [
          {
            type: 'IMAGE',
            imageHash: 'hero-image',
            imageScaleMode: 'FILL',
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true
          }
        ]
      })
      graph.createNode('TEXT', designPage.id, {
        name: 'Reviewed font',
        text: 'Vue Worker font',
        fontFamily: 'Inter',
        fontWeight: 400
      })
      const input = {
        graph,
        pageIds: [designPage.id],
        options: {
          packageName: 'vue-worker-smoke',
          productName: 'Vue Worker Smoke',
          target: 'vue' as const,
          reactVersion: '19' as const,
          router: 'none' as const,
          typescript: true as const,
          devMode: false,
          i18n: true
        },
        fontManifest: {
          faces: [
            {
              family: 'Inter',
              weight: 400,
              style: 'normal',
              format: 'truetype' as const,
              path: 'src/assets/fonts/inter-regular.ttf',
              content: font,
              licenseEvidence: { kind: 'verified_open' as const, licenseIds: ['OFL-1.1'] }
            }
          ]
        }
      }
      const output = await compileVueSourceProjectInWorker(input)
      const asset = output.files.get('src/assets/openpencil-image-hero-image.png')
      const fontAsset = output.files.get('src/assets/fonts/inter-regular.ttf')
      const archive = await archiveVueSourceProjectInWorker(output.files)

      const controller = new AbortController()
      const aborted = compileVueSourceProjectInWorker(input, controller.signal)
      controller.abort()
      let abortName = ''
      try {
        await aborted
      } catch (cause) {
        abortName = cause instanceof Error ? cause.name : String(cause)
      }

      const archiveController = new AbortController()
      const abortedArchive = archiveVueSourceProjectInWorker(output.files, archiveController.signal)
      archiveController.abort()
      let archiveAbortName = ''
      try {
        await abortedArchive
      } catch (cause) {
        archiveAbortName = cause instanceof Error ? cause.name : String(cause)
      }

      return {
        abortName,
        archiveAbortName,
        archiveMagic: [...archive.subarray(0, 4)],
        asset: asset instanceof Uint8Array ? [...asset] : null,
        filesAreMap: output.files instanceof Map,
        fontMatches:
          fontAsset instanceof Uint8Array &&
          fontAsset.length === font.length &&
          fontAsset.every((byte, index) => byte === font[index]),
        fontStillAttached: font.byteLength > 0,
        imageStillAttached: image.byteLength,
        terminations,
        warningCodes: output.warnings.map(({ code }) => code)
      }
    } finally {
      Object.defineProperty(window, 'Worker', { configurable: true, value: NativeWorker })
    }
  })

  expect(result).toEqual({
    abortName: 'AbortError',
    archiveAbortName: 'AbortError',
    archiveMagic: [0x50, 0x4b, 0x03, 0x04],
    asset: [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4],
    filesAreMap: true,
    fontMatches: true,
    fontStillAttached: true,
    imageStillAttached: 12,
    terminations: 4,
    warningCodes: ['vue-i18n-unsupported']
  })
})
