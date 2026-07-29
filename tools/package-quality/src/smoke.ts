import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { publicPackageDirs } from './packages'

const rootDir = fileURLToPath(new URL('../../..', import.meta.url))
const privateDependencyDirs = ['packages/compiler']

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

function nodeEval(code: string, cwd: string): void {
  run(['node', '--input-type=module', '--eval', code], cwd)
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
  for (const packageDir of publicPackageDirs) {
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

  nodeEval("await import('@open-pencil/kiwi')", tempDir)
  nodeEval("await import('@open-pencil/kiwi/schema-runtime')", tempDir)
  nodeEval("await import('@open-pencil/kiwi/fig')", tempDir)
  nodeEval("await import('@open-pencil/kiwi/fig/codec')", tempDir)
  nodeEval("await import('@open-pencil/kiwi/fig/container')", tempDir)
  nodeEval("await import('@open-pencil/kiwi/fig/guid')", tempDir)
  nodeEval("await import('@open-pencil/kiwi/fig/parse')", tempDir)
  nodeEval("await import('@open-pencil/fig')", tempDir)
  nodeEval("await import('@open-pencil/scene-graph')", tempDir)
  nodeEval("await import('@open-pencil/scene-graph/copy')", tempDir)
  nodeEval("await import('@open-pencil/scene-graph/coordinate')", tempDir)
  nodeEval("await import('@open-pencil/scene-graph/geometry')", tempDir)
  nodeEval("await import('@open-pencil/scene-graph/images')", tempDir)
  nodeEval("await import('@open-pencil/scene-graph/matrix')", tempDir)
  nodeEval("await import('@open-pencil/scene-graph/parse-path')", tempDir)
  nodeEval("await import('@open-pencil/scene-graph/primitives')", tempDir)
  nodeEval("await import('@open-pencil/pen')", tempDir)
  nodeEval("await import('@open-pencil/core')", tempDir)
  nodeEval("await import('@open-pencil/motion-runtime')", tempDir)
  nodeEval("await import('@open-pencil/motion-runtime/dom')", tempDir)
  nodeEval("await import('@open-pencil/motion-runtime/kernel')", tempDir)
  nodeEval("await import('@open-pencil/motion-runtime/vanilla')", tempDir)
  nodeEval("await import('@open-pencil/motion-runtime/vue')", tempDir)
  nodeEval("await import('@open-pencil/dom-css')", tempDir)
  nodeEval("await import('@open-pencil/dom-css/browser')", tempDir)
  nodeEval("await import('@open-pencil/dom-css/jsx-runtime')", tempDir)
  nodeEval("await import('@open-pencil/dom-css/jsx-dev-runtime')", tempDir)
  nodeEval("await import('@open-pencil/vue')", tempDir)
  nodeEval("await import('@open-pencil/mcp')", tempDir)

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
  run(['node', 'node_modules/.bin/openpencil-mcp', '--help'], tempDir)
  run(['node', 'node_modules/.bin/openpencil-mcp-http', '--help'], tempDir)

  console.log('Packed package smoke tests passed.')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
