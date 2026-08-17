import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { build as esbuildBuild, type BuildOptions, type Plugin } from 'esbuild'

import { compile, withDefaults } from '@open-pencil/compiler'
import type {
  BrowserPreviewBuildInput,
  BrowserPreviewEsbuild,
  BrowserPreviewEsbuildBuildOptions,
  BrowserPreviewEsbuildBuildResult,
  BrowserPreviewEsbuildPlugin
} from '@open-pencil/compiler/browser-preview'
import { SceneGraph } from '@open-pencil/scene-graph'

const LOCAL_REACT_DEPENDENCY = /^(?:react(?:\/.*)?|react-dom(?:\/.*)?|scheduler(?:\/.*)?)$/

const localReactPlugin: Plugin = {
  name: 'browser-preview-test-local-react',
  setup(builder) {
    builder.onResolve({ filter: LOCAL_REACT_DEPENDENCY }, (args) => ({
      path: fileURLToPath(import.meta.resolve(args.path))
    }))
  }
}

function adaptBrowserPreviewPlugin(plugin: BrowserPreviewEsbuildPlugin): Plugin {
  return {
    name: plugin.name,
    setup(builder) {
      plugin.setup({
        onResolve(options, callback) {
          builder.onResolve(options, async (args) =>
            callback({
              path: args.path,
              importer: args.importer,
              namespace: args.namespace,
              kind: args.kind
            })
          )
        },
        onLoad(options, callback) {
          builder.onLoad(options, async (args) =>
            callback({ path: args.path, namespace: args.namespace })
          )
        }
      })
    }
  }
}

function wrapNodeEsbuild(bundleReact: boolean): BrowserPreviewEsbuild {
  return {
    async build(
      options: BrowserPreviewEsbuildBuildOptions
    ): Promise<BrowserPreviewEsbuildBuildResult> {
      const plugins = options.plugins.map(adaptBrowserPreviewPlugin)
      const source: BuildOptions = {
        ...options,
        entryPoints: [...options.entryPoints],
        target: [...options.target],
        define: { ...options.define },
        plugins: bundleReact ? [localReactPlugin, ...plugins] : plugins
      }
      const result = await esbuildBuild(source)
      return {
        errors: result.errors.map((error) => ({
          text: error.text,
          location: error.location
            ? {
                file: error.location.file,
                line: error.location.line,
                column: error.location.column
              }
            : null
        })),
        warnings: result.warnings.map((warning) => ({
          text: warning.text,
          location: warning.location
            ? {
                file: warning.location.file,
                line: warning.location.line,
                column: warning.location.column
              }
            : null
        })),
        outputFiles: result.outputFiles?.map((file) => ({
          path: file.path,
          contents: file.contents,
          text: file.text
        }))
      }
    }
  }
}

export function compileBrowserPreviewFixture(
  text = 'Browser preview is ready'
): Map<string, string | Uint8Array> {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.createNode('TEXT', page.id, {
    name: 'Preview marker',
    text,
    x: 24,
    y: 24,
    width: 320,
    height: 48
  })
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ packageName: 'browser-preview-test', devMode: true })
  }).files
}

export async function browserPreviewInput(
  files: ReadonlyMap<string, string | Uint8Array>,
  options: { bundleReact?: boolean; target?: 'react' | 'vue' } = {}
): Promise<BrowserPreviewBuildInput> {
  const stylesheetPath = fileURLToPath(import.meta.resolve('tailwindcss/index.css'))
  return {
    files,
    target: options.target ?? 'react',
    wasmURL: '/esbuild.wasm',
    channel: 'browser_preview_test_channel_0001',
    esbuild: wrapNodeEsbuild(options.bundleReact === true),
    tailwindStylesheet: await readFile(stylesheetPath, 'utf8')
  }
}
