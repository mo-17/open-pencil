import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CompilerOutput } from '@open-pencil/compiler'

export function typeCheckDataModules(output: CompilerOutput, target: 'react' | 'vue'): void {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-data-grid-types-'))
  try {
    const dependencies =
      target === 'vue'
        ? ['vue', 'vue-router', 'vite']
        : ['react', 'react-dom', '@types/react', '@types/react-dom', 'zustand', 'vite']
    for (const dependency of dependencies) {
      const installed = ['packages/compiler', '.']
        .map((workspace) => resolve(workspace, 'node_modules', dependency))
        .find(existsSync)
      if (!installed) throw new Error('Missing workspace test dependency: ' + dependency)
      const destination = join(directory, 'node_modules', dependency)
      mkdirSync(dirname(destination), { recursive: true })
      symlinkSync(installed, destination, 'dir')
    }
    for (const [path, content] of output.files) {
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
    execFileSync('node', [tool, '--noEmit', '-p', join(directory, 'tsconfig.json')], {
      cwd: directory,
      timeout: 30000,
      stdio: 'inherit'
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
