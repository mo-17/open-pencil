import { zlibSync } from 'fflate'

import { withDefaults } from '@open-pencil/compiler'
import { isPlainJSONObject } from '@open-pencil/scene-graph'

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

const TAURI_ICON_PATH = 'icons/icon.png'
const TAURI_ICON_ARCHIVE_PATH = `src-tauri/${TAURI_ICON_PATH}`
const TAURI_ICON_SIZE = 512
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_IHDR = new Uint8Array([0x49, 0x48, 0x44, 0x52])
const PNG_IDAT = new Uint8Array([0x49, 0x44, 0x41, 0x54])
const PNG_IEND = new Uint8Array([0x49, 0x45, 0x4e, 0x44])

function writeUint32(output: Uint8Array, offset: number, value: number): void {
  output[offset] = (value >>> 24) & 0xff
  output[offset + 1] = (value >>> 16) & 0xff
  output[offset + 2] = (value >>> 8) & 0xff
  output[offset + 3] = value & 0xff
}

function pngCrc32(type: Uint8Array, data: Uint8Array): number {
  let crc = 0xffffffff
  for (const bytes of [type, data]) {
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: Uint8Array, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(data.byteLength + 12)
  writeUint32(output, 0, data.byteLength)
  output.set(type, 4)
  output.set(data, 8)
  writeUint32(output, data.byteLength + 8, pngCrc32(type, data))
  return output
}

function concatenateBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function isInsideRoundedIcon(x: number, y: number): boolean {
  const inset = 24
  const farEdge = TAURI_ICON_SIZE - inset - 1
  const radius = 104
  if (x < inset || x > farEdge || y < inset || y > farEdge) return false
  if (
    (x >= inset + radius && x <= farEdge - radius) ||
    (y >= inset + radius && y <= farEdge - radius)
  ) {
    return true
  }
  const centerX = x < inset + radius ? inset + radius : farEdge - radius
  const centerY = y < inset + radius ? inset + radius : farEdge - radius
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2
}

/** Build a deterministic 512px RGBA PNG without relying on a data URL or an external file. */
function createDefaultTauriIconPNG(): Uint8Array {
  const rowBytes = TAURI_ICON_SIZE * 4 + 1
  const pixels = new Uint8Array(rowBytes * TAURI_ICON_SIZE)
  for (let y = 0; y < TAURI_ICON_SIZE; y += 1) {
    const rowOffset = y * rowBytes
    pixels[rowOffset] = 0 // PNG filter: None
    for (let x = 0; x < TAURI_ICON_SIZE; x += 1) {
      if (!isInsideRoundedIcon(x, y)) continue
      const offset = rowOffset + 1 + x * 4
      const pencilBody = x + y >= 476 && x + y <= 548 && x - y >= -248 && x - y <= 248
      const pencilTip = x + y >= 476 && x + y <= 548 && x - y < -248 && x - y >= -312
      if (pencilBody) {
        pixels.set([0xf8, 0xfa, 0xfc, 0xff], offset)
      } else if (pencilTip) {
        pixels.set([0xfd, 0xba, 0x74, 0xff], offset)
      } else {
        pixels.set([0x25, 0x63, 0xeb, 0xff], offset)
      }
    }
  }

  const header = new Uint8Array(13)
  writeUint32(header, 0, TAURI_ICON_SIZE)
  writeUint32(header, 4, TAURI_ICON_SIZE)
  header.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA, deflate, adaptive filtering, no interlace
  return concatenateBytes([
    PNG_SIGNATURE,
    pngChunk(PNG_IHDR, header),
    pngChunk(PNG_IDAT, zlibSync(pixels, { level: 9 })),
    pngChunk(PNG_IEND, new Uint8Array())
  ])
}

function rustCrateName(packageName: string): string {
  const crate = packageName.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return crate || 'openpencil_app'
}

function bundleIdentifier(packageName: string): string {
  const tail = packageName.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return `dev.openpencil.${tail || 'app'}`
}

function updatePackageJSON(source: string, productName: string): string {
  const parsed: unknown = JSON.parse(source)
  if (!isPlainJSONObject(parsed)) throw new TypeError('Compiler package.json must be an object')
  const scripts = isPlainJSONObject(parsed.scripts) ? parsed.scripts : {}
  const dependencies = isPlainJSONObject(parsed.dependencies) ? parsed.dependencies : {}
  const devDependencies = isPlainJSONObject(parsed.devDependencies) ? parsed.devDependencies : {}
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
  const packageJSON = compiledFiles.get('package.json')
  if (typeof packageJSON !== 'string') {
    throw new TypeError('Compiler output is missing a text package.json')
  }
  const crateName = rustCrateName(packageName)
  const files = new Map(compiledFiles)
  files.set('package.json', updatePackageJSON(packageJSON, productName))
  files.set(TAURI_ICON_ARCHIVE_PATH, createDefaultTauriIconPNG())
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
        bundle: { active: true, targets: 'all', icon: [TAURI_ICON_PATH] }
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
