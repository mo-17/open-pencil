import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { publicPackageDirs } from './packages'

const rootDir = fileURLToPath(new URL('../../..', import.meta.url))
const privateDependencyDirs = ['packages/compiler']
const tsgoBin = join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo'
)

function run(command: string[], cwd = rootDir, env: Record<string, string> = {}): string {
  const proc = Bun.spawnSync(command, {
    cwd,
    env: { ...Bun.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const stdout = proc.stdout.toString()
  const stderr = proc.stderr.toString()
  if (!proc.success) {
    console.error(`$ ${command.join(' ')}`)
    if (stdout) console.error(stdout)
    if (stderr) console.error(stderr)
    process.exit(proc.exitCode || 1)
  }
  return stdout.trim()
}

const EVAL_TIMEOUT_S = 30

function nodeEval(code: string, cwd: string): void {
  const timeoutBin =
    process.platform === 'win32' ? null : (Bun.which('timeout') ?? Bun.which('gtimeout'))
  const args = timeoutBin
    ? [timeoutBin, String(EVAL_TIMEOUT_S), 'node', '--input-type=module', '--eval', code]
    : ['node', '--input-type=module', '--eval', code]
  run(args, cwd)
}

function writeTypeConsumer(cwd: string): void {
  writeFileSync(
    join(cwd, 'tsconfig.package-smoke.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          lib: ['ES2022', 'DOM'],
          typeRoots: [join(rootDir, 'node_modules', '@types')],
          skipLibCheck: true,
          noEmit: true
        },
        include: ['package-type-consumer.ts']
      },
      null,
      2
    ),
    'utf8'
  )

  writeFileSync(
    join(cwd, 'package-type-consumer.ts'),
    `import { createEditor, type Editor, type PluginManifest as CoreRootPluginManifest } from '@open-pencil/core'
import { parseExpression as parseExpressionCompat } from '@open-pencil/core/lowcode-validation'
import type { ApplicationRuntimeAudit as ApplicationRuntimeAuditCompat } from '@open-pencil/core/lowcode-validation/application-runtime'
import { parseVersionedPluginManifestPayload as parsePluginManifestCompat, type PluginManifest as CorePluginManifest } from '@open-pencil/core/plugins'
import { htmlToDesignDocument, type DesignDocument } from '@open-pencil/dom-css'
import { FIG_PACKAGE_STATUS, type FigContainerDocument } from '@open-pencil/fig'
import { FIG_KIWI_DEFAULT_VERSION, buildFigKiwi } from '@open-pencil/kiwi/fig/container'
import { type GUID as KiwiGUID } from '@open-pencil/kiwi/fig'
import { parseExpression, type ExprAst } from '@open-pencil/lowcode'
import { parsePenFile, type PenDocument } from '@open-pencil/pen'
import { parseVersionedPluginManifestPayload, type MarketplaceSnapshotPayloadV1, type PluginManifest, type PluginRuntimeIndexPayloadV1 } from '@open-pencil/plugin-contracts'
import { hasExactPluginKeys } from '@open-pencil/plugin-contracts/adapter-helpers'
import { SceneGraph, type Color, type SceneNode, type Vector } from '@open-pencil/scene-graph'
import { testIdSelector } from '@open-pencil/vue'

const graph = new SceneGraph()
const editorFactory: typeof createEditor = createEditor
declare const editor: Editor
declare const designDocument: DesignDocument
declare const expression: ExprAst
declare const applicationRuntimeAudit: ApplicationRuntimeAuditCompat
declare const pluginManifest: PluginManifest
declare const marketplaceSnapshot: MarketplaceSnapshotPayloadV1
declare const pluginRuntimeIndex: PluginRuntimeIndexPayloadV1
const corePluginManifest: CorePluginManifest = pluginManifest
const coreRootPluginManifest: CoreRootPluginManifest = pluginManifest
const ownerManifestFromCompat: PluginManifest = corePluginManifest

const color: Color = { r: 1, g: 0.5, b: 0, a: 1 }
const vector: Vector = { x: 1, y: 2 }
const maybeNode: SceneNode | undefined = graph.getPages()[0]
const penDocument: PenDocument = { version: '1', children: [] }
const figDocument: FigContainerDocument = {
  schemaDeflated: new Uint8Array([1]),
  dataRaw: new Uint8Array([2])
}
const kiwiGuid: KiwiGUID = { sessionID: 1, localID: 2 }

void editorFactory
void editor
void designDocument
void expression
void applicationRuntimeAudit
void pluginManifest
void marketplaceSnapshot
void pluginRuntimeIndex
void corePluginManifest
void coreRootPluginManifest
void ownerManifestFromCompat
void color
void vector
void maybeNode
void penDocument
void figDocument
void kiwiGuid
void FIG_PACKAGE_STATUS
void FIG_KIWI_DEFAULT_VERSION
void buildFigKiwi
void parseExpression
void parseExpressionCompat
void parseVersionedPluginManifestPayload
void parsePluginManifestCompat
void hasExactPluginKeys
void parsePenFile
void htmlToDesignDocument
void testIdSelector
`,
    'utf8'
  )
}

function checkTypeConsumer(cwd: string): void {
  writeTypeConsumer(cwd)
  run([tsgoBin, '--noEmit', '-p', 'tsconfig.package-smoke.json'], cwd)
}

interface PackageJSON {
  name: string
  types?: string
  exports?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readPackageJSON(packageDir: string): PackageJSON {
  return JSON.parse(readFileSync(join(rootDir, packageDir, 'package.json'), 'utf8'))
}

function collectExportTypePaths(value: unknown, paths: string[] = []): string[] {
  if (typeof value === 'string') return paths
  if (!value || typeof value !== 'object') return paths
  for (const [key, child] of Object.entries(value)) {
    if (key === 'types' && typeof child === 'string') paths.push(child)
    else collectExportTypePaths(child, paths)
  }
  return paths
}

function packageArchivePath(path: string): string {
  return `package/${path.replace(/^\.\//, '')}`
}

function exportKeyToSpecifier(packageName: string, exportKey: string): string | null {
  if (exportKey === './package.json') return null
  if (exportKey === '.') return packageName
  if (!exportKey.startsWith('./')) {
    throw new Error(`${packageName}: unsupported export key ${exportKey}`)
  }
  if (exportKey.includes('*')) {
    throw new Error(
      `${packageName}: package smoke cannot exhaustively import pattern export ${exportKey}`
    )
  }
  return `${packageName}/${exportKey.slice(2)}`
}

function collectPublicImportSpecifiers(packageJSON: PackageJSON): string[] {
  const { exports } = packageJSON
  if (!exports) return []
  if (typeof exports === 'string') return [packageJSON.name]
  if (!isRecord(exports)) return []

  const keys = Object.keys(exports)
  if (keys.length === 0) return []

  const hasExportMapKeys = keys.some((key) => key.startsWith('.'))
  if (!hasExportMapKeys) return [packageJSON.name]

  const specifiers: string[] = []
  for (const key of keys) {
    const specifier = exportKeyToSpecifier(packageJSON.name, key)
    if (specifier) specifiers.push(specifier)
  }
  return specifiers
}

function bunEval(code: string, cwd: string): void {
  run(['bun', '--eval', code], cwd)
}

const tempDir = mkdtempSync(join(tmpdir(), 'open-pencil-package-smoke-'))

try {
  run(['bun', 'run', 'build:packages'])

  const packPackage = (packageDir: string): string => {
    const output = run(
      ['bun', 'pm', 'pack', '--destination', tempDir, '--quiet'],
      join(rootDir, packageDir)
    )
    const filename = output
      .split('\n')
      .map((line) => line.trim())
      .findLast((line) => line.endsWith('.tgz'))
    if (!filename) throw new Error(`No tarball produced for ${packageDir}`)
    return filename.startsWith('/') ? filename : join(tempDir, filename)
  }

  const tarballs: string[] = []
  const publicImportSpecifiers = new Set<string>()
  for (const packageDir of publicPackageDirs) {
    const packageJSON = readPackageJSON(packageDir)
    for (const specifier of collectPublicImportSpecifiers(packageJSON)) {
      publicImportSpecifiers.add(specifier)
    }
    const tarball = packPackage(packageDir)
    tarballs.push(tarball)
    const contents = run(['tar', '-tf', tarball])
    const runtimeTs = contents
      .split('\n')
      .filter((entry) => /package\/src\/.*\.ts$/.test(entry) && !entry.endsWith('.d.ts'))
    if (runtimeTs.length > 0) {
      console.error(`${basename(tarball)} includes runtime TypeScript:\n${runtimeTs.join('\n')}`)
      process.exit(1)
    }

    const entries = new Set(contents.split('\n'))
    const typePaths = [
      ...(packageJSON.types ? [packageJSON.types] : []),
      ...collectExportTypePaths(packageJSON.exports)
    ]
    const missingTypePaths = typePaths
      .map(packageArchivePath)
      .filter((entry) => !entries.has(entry))
    if (missingTypePaths.length > 0) {
      console.error(
        `${basename(tarball)} is missing declared type files:\n${missingTypePaths.join('\n')}`
      )
      process.exit(1)
    }
  }
  for (const packageDir of privateDependencyDirs) {
    tarballs.push(packPackage(packageDir))
  }

  run(['npm', 'init', '-y'], tempDir)
  run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], tempDir, {
    npm_config_cache: join(tempDir, '.npm-cache')
  })

  const compilerKernelProbe = join(tempDir, 'compiler-motion-kernel-probe.mjs')
  const compilerKernelBundle = join(tempDir, 'compiler-motion-kernel-probe.bundle.mjs')
  writeFileSync(
    compilerKernelProbe,
    `import { buildMotionRuntime } from '@open-pencil/compiler/adapters/react/motion/runtime'

const source = buildMotionRuntime([
  { token: 'probe', motion: { version: 3, reducedMotion: 'allow', tracks: [] } }
])
if (!source?.includes('Embedded from @open-pencil/motion-runtime/kernel')) {
  throw new Error('Minified compiler did not embed the public Motion kernel')
}
if (source.includes("from '@open-pencil/motion-runtime")) {
  throw new Error('Generated Motion runtime is not self-contained')
}
const executable = source + String.raw\`
const __probeTrack: MotionTrack = {
  id: 'probe', trigger: 'mount', exit: 'none', keyframes: [],
  timing: { duration: 100, delay: 0, easing: 'linear', iterations: 1, direction: 'normal', fill: 'both' },
  composition: { mode: 'replace', weight: 1, priority: 0, sourceIndex: 0, clock: '--clock', weightVariable: '--weight', variables: { x: '--x' }, sampling: { easing: 'linear', keyframes: [{ offset: 0, values: { x: 0 } }, { offset: 1, values: { x: 100 } }] } }
}
if (sharedSampleMotionRuntimeChannel(__probeTrack, 'x', 0.25) !== 25) throw new Error('Embedded channel sampler failed')
if (sharedMotionRuntimeTrackProgress(__probeTrack, 50).progress !== 0.5) throw new Error('Embedded timing sampler failed')
if (!Number.isFinite(sharedSampleMotionRuntimeEasing({ type: 'cubicBezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 }, 0.25))) throw new Error('Embedded easing sampler failed')
\`
const runtimeFile = new URL('./compiler-motion-runtime.generated.mjs', import.meta.url)
await Bun.write(runtimeFile, new Bun.Transpiler({ loader: 'ts' }).transformSync(executable))
await import(runtimeFile.href)
globalThis.__OPENPENCIL_MOTION_RUNTIME__?.dispose()
`
  )
  run(
    [
      'bun',
      'build',
      compilerKernelProbe,
      '--target=node',
      '--format=esm',
      '--minify',
      `--outfile=${compilerKernelBundle}`
    ],
    tempDir
  )
  run(['bun', compilerKernelBundle], tempDir)
  bunEval("await import('@open-pencil/motion-runtime/kernel')", tempDir)

  // @open-pencil/mcp/stdio is a CLI entry point that creates a WebSocket
  // connection on import. It is verified via the openpencil-mcp --help
  // command below, not via import eval.
  const evalSkipSpecifiers = new Set(['@open-pencil/mcp/stdio'])

  for (const specifier of [...publicImportSpecifiers].sort()) {
    if (evalSkipSpecifiers.has(specifier)) continue
    nodeEval(`await import(${JSON.stringify(specifier)})`, tempDir)
  }

  checkTypeConsumer(tempDir)

  nodeEval(
    "const { guidToString } = await import('@open-pencil/kiwi/fig/guid'); if (guidToString({ sessionID: 1, localID: 2 }) !== '1:2') throw new Error('Kiwi GUID subpath failed')",
    tempDir
  )
  nodeEval(
    "const { buildFigKiwi, parseFigKiwiChunks } = await import('@open-pencil/kiwi/fig/container'); const chunks = parseFigKiwiChunks(buildFigKiwi(new Uint8Array([1]), new Uint8Array([2]))); if (chunks?.length !== 2) throw new Error('Kiwi container subpath failed')",
    tempDir
  )
  nodeEval(
    "const { FIG_PACKAGE_STATUS, effectiveFigmaRawNodeFields, parseFigBuffer, writeFigArchive, readFigContainer, writeFigContainer } = await import('@open-pencil/fig'); if (FIG_PACKAGE_STATUS !== 'archive-api' || typeof effectiveFigmaRawNodeFields !== 'function' || typeof parseFigBuffer !== 'function' || typeof writeFigArchive !== 'function') throw new Error('Fig package status smoke failed'); const document = readFigContainer(writeFigContainer({ schemaDeflated: new Uint8Array([1]), dataRaw: new Uint8Array([2]) })); if (document.dataRaw[0] !== 2) throw new Error('Fig container smoke failed')",
    tempDir
  )
  nodeEval(
    "const { convertLineHeight, sceneNodeToKiwi } = await import('@open-pencil/fig/node-change'); if (convertLineHeight({ value: 120, units: 'PERCENT' }, 20) !== 24 || typeof sceneNodeToKiwi !== 'function') throw new Error('Fig NodeChange subpath failed')",
    tempDir
  )
  nodeEval(
    "const { populateAndApplyOverrides } = await import('@open-pencil/fig/instance-overrides'); if (typeof populateAndApplyOverrides !== 'function') throw new Error('Fig instance override subpath failed')",
    tempDir
  )
  nodeEval(
    "const { SceneGraph } = await import('@open-pencil/scene-graph'); const graph = new SceneGraph(); if (graph.getPages().length !== 1) throw new Error('SceneGraph package smoke failed')",
    tempDir
  )
  nodeEval(
    "const { parseExpression } = await import('@open-pencil/lowcode'); const parsed = parseExpression('count + 1'); if (!parsed.ok || !parsed.references.has('count')) throw new Error('Lowcode package smoke failed')",
    tempDir
  )
  nodeEval(
    "const owner = await import('@open-pencil/lowcode'); const ownerRuntime = await import('@open-pencil/lowcode/application-runtime'); const compat = await import('@open-pencil/core/lowcode-validation'); const compatRuntime = await import('@open-pencil/core/lowcode-validation/application-runtime'); if (compat.parseExpression !== owner.parseExpression || compatRuntime.auditApplicationRuntime !== ownerRuntime.auditApplicationRuntime) throw new Error('Core lowcode compatibility export failed')",
    tempDir
  )
  nodeEval(
    "const owner = await import('@open-pencil/plugin-contracts'); const helpers = await import('@open-pencil/plugin-contracts/adapter-helpers'); const pluginsCompat = await import('@open-pencil/core/plugins'); const rootCompat = await import('@open-pencil/core'); const representative = ['parsePluginObjectParameterSchema', 'parsePluginConnectorContract', 'parseVersionedPluginManifest', 'verifyVersionedPluginPackage', 'parseTrustedPluginKeyring', 'verifyPluginCatalog', 'verifyPluginRuntimePackage', 'verifyPluginRuntimeIndex', 'verifyMarketplaceSnapshot', 'verifyMarketplaceRuntimeIndex', 'PluginTrustError', 'PluginRuntimeTrustError', 'MarketplaceSnapshotTrustError']; for (const key of representative) if (typeof owner[key] === 'undefined') throw new Error('Plugin contracts representative export missing: ' + key); for (const key of Object.keys(owner)) if (pluginsCompat[key] !== owner[key] || rootCompat[key] !== owner[key]) throw new Error('Core plugin contract compatibility export failed: ' + key); const payload = { format: 'openpencil-plugin', schemaVersion: 1, plugin: { id: 'smoke.plugin', name: 'Smoke Plugin', version: '1.0.0' }, publisher: { id: 'smoke', name: 'Smoke Publisher', keyId: 'smoke.release' }, engineRange: '>=0.14.0 <1.0.0', capabilities: [], contributions: { modules: [{ moduleType: 'smoke', name: 'Smoke', description: 'Packed package probe', adapterId: 'smoke.adapter', configVersion: 1, defaultSize: { width: 1, height: 1 }, defaultConfig: {}, fields: [] }] } }; if (owner.parseVersionedPluginManifestPayload(payload).plugin.id !== 'smoke.plugin') throw new Error('Plugin manifest contract smoke failed'); if (!helpers.hasExactPluginKeys({ enabled: true }, new Set(['enabled']))) throw new Error('Plugin adapter helper smoke failed')",
    tempDir
  )
  nodeEval(
    "const { createManualMotionClock, createMotionRuntime } = await import('@open-pencil/motion-runtime'); const clock = createManualMotionClock(); const runtime = createMotionRuntime({ clock }); let x = -1; const handle = runtime.register({ id: 'smoke', motion: { version: 1, tracks: [{ id: 'move', trigger: 'mount', keyframes: [{ offset: 0, x: 0 }, { offset: 1, x: 10 }], timing: { durationMs: 100, easing: 'linear' } }] }, apply: ({ sample }) => { x = sample.visual.x } }); handle.play(); clock.advanceBy(50); if (x !== 5) throw new Error('Motion runtime package smoke failed'); runtime.dispose()",
    tempDir
  )
  nodeEval(
    "const { buildMotionRuntimeKernelSource, sampleMotionRuntimeChannel } = await import('@open-pencil/motion-runtime/kernel'); const track = { timing: { duration: 100, delay: 0, iterations: 1, direction: 'normal', fill: 'both' }, composition: { sampling: { easing: 'linear', keyframes: [{ offset: 0, values: { x: 0 } }, { offset: 1, values: { x: 100 } }] } } }; if (sampleMotionRuntimeChannel(track, 'x', 0.25) !== 25 || !buildMotionRuntimeKernelSource().includes('Embedded from @open-pencil/motion-runtime/kernel')) throw new Error('Motion runtime kernel package smoke failed')",
    tempDir
  )
  nodeEval(
    "const { parsePenFile } = await import('@open-pencil/pen'); const graph = parsePenFile(JSON.stringify({ version: '1', children: [{ id: 'frame', type: 'frame', width: 100, height: 50 }] })); if (graph.getPages()[0].childIds.length !== 1) throw new Error('Pen package smoke failed')",
    tempDir
  )
  nodeEval(
    "const { htmlToSceneGraph } = await import('@open-pencil/dom-css'); const graph = await htmlToSceneGraph('<div class=card>OpenPencil</div>', { cssText: '.card { width: 320px; }' }); if (graph.getPages()[0].width !== 320) throw new Error('DOM/CSS scene graph smoke failed')",
    tempDir
  )
  nodeEval(
    "const browser = await import('@open-pencil/dom-css/browser'); for (const key of ['browserHTMLToDesignDocument', 'browserHTMLToSceneGraph', 'browserTailwindJSXToSceneGraph']) if (typeof browser[key] !== 'function') throw new Error('DOM/CSS browser export missing: ' + key)",
    tempDir
  )
  nodeEval(
    "const { jsx, jsxToDesignDocument } = await import('@open-pencil/dom-css/jsx-runtime'); const document = await jsxToDesignDocument(jsx('section', { class: 'card', style: { width: '120px' }, children: 'OpenPencil' })); const node = document.children[0]; if (node?.type !== 'element' || node.inlineStyle?.width !== '120px') throw new Error('DOM/CSS JSX runtime smoke failed')",
    tempDir
  )

  run(['node', 'node_modules/.bin/openpencil', '--help'], tempDir)
  run(['node', 'node_modules/.bin/openpencil', 'plugin', 'manifest', '--help'], tempDir)
  run(['node', 'node_modules/.bin/openpencil', 'plugin', 'catalog', '--help'], tempDir)
  run(['node', 'node_modules/.bin/openpencil', 'plugin', 'runtime', '--help'], tempDir)
  run(['node', 'node_modules/.bin/openpencil', 'plugin', 'runtime-index', '--help'], tempDir)
  run(['node', 'node_modules/.bin/openpencil-mcp', '--help'], tempDir)
  run(['node', 'node_modules/.bin/openpencil-mcp-http', '--help'], tempDir)

  console.log('Packed package smoke tests passed.')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
