import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installedMarkdownDependency } from '#compiler/markdown-dependencies'

/** Type-check generated source against locally installed dependencies without installing or building. */
export function typeCheckCompilerFiles(
  files: ReadonlyMap<string, string>,
  target: 'react' | 'vue',
  options: {
    preserveSymlinks?: boolean
    extraDependencies?: readonly string[]
    dependencyDirectories?: Readonly<Record<string, string>>
  } = {}
): void {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-control-types-'))
  try {
    const manifest = JSON.parse(files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }
    for (const dependency of [
      ...Object.keys(manifest.dependencies),
      ...(target === 'react' ? ['@types/react', '@types/react-dom'] : []),
      ...(options.extraDependencies ?? []),
      'vite'
    ]) {
      const installed =
        options.dependencyDirectories?.[dependency] ??
        ['packages/compiler', '.']
          .map((workspace) => resolve(workspace, 'node_modules', dependency))
          .find(existsSync) ??
        installedMarkdownDependency(dependency, process.cwd()) ??
        resolveInstalledDependency(dependency)
      if (!installed) throw new Error('Missing workspace test dependency: ' + dependency)
      const destination = join(directory, 'node_modules', dependency)
      mkdirSync(dirname(destination), { recursive: true })
      symlinkSync(installed, destination, 'dir')
    }
    for (const [path, content] of files) {
      const destination = join(directory, path)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, content)
    }
    const tool =
      target === 'vue'
        ? join(
            dirname(fileURLToPath(import.meta.resolve('vue-tsc/package.json'))),
            'bin/vue-tsc.js'
          )
        : join(dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc')
    execFileSync(
      'node',
      [
        tool,
        '--noEmit',
        ...(options.preserveSymlinks ? ['--preserveSymlinks'] : []),
        '-p',
        join(directory, 'tsconfig.json')
      ],
      {
        cwd: directory,
        timeout: 30000,
        stdio: 'inherit'
      }
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function resolveInstalledDependency(dependency: string): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.resolve(dependency + '/package.json')))
  } catch {
    return undefined
  }
}
