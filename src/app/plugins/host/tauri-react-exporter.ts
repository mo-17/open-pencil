import { withDefaults } from '@open-pencil/compiler'
import { isPlainJsonObject } from '@open-pencil/scene-graph'

import { saveExportedFile } from '@/app/document/export/files'
import { downloadBlob } from '@/app/document/io/browser'
import type { EditorStore } from '@/app/editor/active-store'

import {
  chooseSourceProjectDestination,
  createDefaultSourceProjectExporterDependencies,
  runSourceProjectExport,
  sourceProjectNames,
  type SourceProjectExportDestination,
  type SourceProjectExporterDependencies,
  type SourceProjectExportResult
} from './source-exporter-runtime'

export type TauriReactExportResult = SourceProjectExportResult

function rustCrateName(packageName: string): string {
  const crate = packageName.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return crate || 'openpencil_app'
}

function bundleIdentifier(packageName: string): string {
  const tail = packageName.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return `dev.openpencil.${tail || 'app'}`
}

function updatePackageJson(source: string, productName: string): string {
  const parsed: unknown = JSON.parse(source)
  if (!isPlainJsonObject(parsed)) throw new TypeError('Compiler package.json must be an object')
  const scripts = isPlainJsonObject(parsed.scripts) ? parsed.scripts : {}
  const dependencies = isPlainJsonObject(parsed.dependencies) ? parsed.dependencies : {}
  const devDependencies = isPlainJsonObject(parsed.devDependencies) ? parsed.devDependencies : {}
  return `${JSON.stringify(
    {
      ...parsed,
      description: `Tauri desktop project exported from ${productName} in OpenPencil`,
      scripts: { ...scripts, tauri: 'tauri' },
      dependencies: { ...dependencies, '@tauri-apps/api': '^2.0.0' },
      devDependencies: { ...devDependencies, '@tauri-apps/cli': '^2.0.0' }
    },
    null,
    2
  )}\n`
}

export function buildTauriReactProjectFiles(
  compiledFiles: ReadonlyMap<string, string | Uint8Array>,
  packageName: string,
  productName: string
): Map<string, string | Uint8Array> {
  const packageJson = compiledFiles.get('package.json')
  if (typeof packageJson !== 'string') {
    throw new TypeError('Compiler output is missing a text package.json')
  }
  const crateName = rustCrateName(packageName)
  const files = new Map(compiledFiles)
  files.set('package.json', updatePackageJson(packageJson, productName))
  files.set(
    'src-tauri/Cargo.toml',
    `[package]\nname = "${crateName}"\nversion = "0.1.0"\ndescription = "Tauri desktop project exported from OpenPencil"\nauthors = []\nedition = "2021"\n\n[lib]\nname = "${crateName}_lib"\ncrate-type = ["staticlib", "cdylib", "rlib"]\n\n[build-dependencies]\ntauri-build = { version = "2", features = [] }\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\ntauri = { version = "2", features = [] }\n`
  )
  files.set('src-tauri/build.rs', 'fn main() {\n    tauri_build::build()\n}\n')
  files.set(
    'src-tauri/src/lib.rs',
    '#[cfg_attr(mobile, tauri::mobile_entry_point)]\npub fn run() {\n    tauri::Builder::default()\n        .run(tauri::generate_context!())\n        .expect("error while running Tauri application");\n}\n'
  )
  files.set(
    'src-tauri/src/main.rs',
    `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\nfn main() {\n    ${crateName}_lib::run();\n}\n`
  )
  files.set(
    'src-tauri/tauri.conf.json',
    `${JSON.stringify(
      {
        $schema: 'https://schema.tauri.app/config/2',
        productName,
        version: '0.1.0',
        identifier: bundleIdentifier(packageName),
        build: {
          beforeDevCommand: 'npm run dev',
          devUrl: 'http://localhost:5173',
          beforeBuildCommand: 'npm run build',
          frontendDist: '../dist'
        },
        app: {
          windows: [{ title: productName, width: 1280, height: 800, resizable: true }],
          security: { csp: null }
        },
        bundle: { active: true, targets: 'all' }
      },
      null,
      2
    )}\n`
  )
  files.set(
    'README.md',
    `# ${productName}\n\nThis Tauri 2 + React source project was exported from OpenPencil.\n\n## Run locally\n\n\`\`\`sh\nnpm install\nnpm run tauri dev\n\`\`\`\n\n## Build installers\n\n\`\`\`sh\nnpm run tauri build\n\`\`\`\n\nThe export contains source files only. OpenPencil did not install dependencies or run Node, Bun, Cargo, or native build commands.\n`
  )
  files.set('src-tauri/.gitignore', '/target/\n/gen/\n')
  return files
}

async function chooseTauriReactDestination(
  fileName: string,
  signal?: AbortSignal
): Promise<SourceProjectExportDestination | null> {
  // Preserve the established direct-write menu behavior (notably Windows
  // replacement semantics). MCP calls carry a signal and use the atomic path.
  if (signal) return chooseSourceProjectDestination(fileName, 'Tauri project', signal)
  return {
    write(data) {
      return saveExportedFile(
        data,
        fileName,
        'Tauri project',
        '.zip',
        'application/zip',
        downloadBlob
      )
    }
  }
}

const DEFAULT_DEPENDENCIES: SourceProjectExporterDependencies<EditorStore> = Object.freeze({
  ...createDefaultSourceProjectExporterDependencies<EditorStore>('Tauri project'),
  chooseDestination: chooseTauriReactDestination
})

export async function exportCurrentDocumentAsTauriReactSource(
  editor: EditorStore,
  signal?: AbortSignal
): Promise<TauriReactExportResult> {
  const names = sourceProjectNames(editor.state.documentName)
  const packageName = names.package
  const productName = names.product
  const fileName = `${packageName}-tauri.zip`
  return runSourceProjectExport({
    editor,
    dependencies: DEFAULT_DEPENDENCIES,
    fileName,
    signal,
    createCompilerInput({ pageIds, fontManifest }) {
      return {
        graph: editor.graph,
        pageIds,
        fontManifest,
        options: withDefaults({
          packageName,
          router: pageIds.length > 1 ? 'react-router-v6' : 'none',
          devMode: false
        })
      }
    },
    buildProject(compiledFiles) {
      return buildTauriReactProjectFiles(compiledFiles, packageName, productName)
    }
  })
}
