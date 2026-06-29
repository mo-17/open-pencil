import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('../../..', import.meta.url))
const packageDirs = ['packages/core', 'packages/vue', 'packages/mcp', 'packages/cli']
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
  for (const packageDir of packageDirs) {
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

  nodeEval("await import('@open-pencil/core')", tempDir)
  nodeEval("await import('@open-pencil/core/scene-graph')", tempDir)
  nodeEval("await import('@open-pencil/vue')", tempDir)
  nodeEval("await import('@open-pencil/mcp')", tempDir)

  run(['node', 'node_modules/.bin/openpencil', '--help'], tempDir)
  run(['node', 'node_modules/.bin/openpencil-mcp', '--help'], tempDir)
  run(['node', 'node_modules/.bin/openpencil-mcp-http', '--help'], tempDir)

  console.log('Packed package smoke tests passed.')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
