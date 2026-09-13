import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { emitNestJSProject } from '@open-pencil/compiler/backend/nestjs/project'

import { nestJSApplication } from './helpers'

test('generated backend types exclude ancestor frontend ambient types while checking Node fetch', () => {
  const root = mkdtempSync(join(tmpdir(), 'openpencil-backend-types-'))
  try {
    const backend = join(root, 'backend/nestjs')
    const localTypes = join(backend, 'node_modules/@types')
    const ancestorTypes = join(root, 'node_modules/@types/foreign-framework')
    mkdirSync(localTypes, { recursive: true })
    mkdirSync(ancestorTypes, { recursive: true })
    mkdirSync(join(backend, 'src'), { recursive: true })
    symlinkSync(
      dirname(fileURLToPath(import.meta.resolve('@types/node/package.json'))),
      join(localTypes, 'node'),
      'dir'
    )
    writeFileSync(
      join(ancestorTypes, 'index.d.ts'),
      'declare const foreignFrameworkConflict: number;\ndeclare const foreignFrameworkConflict: string;\n'
    )
    writeFileSync(join(backend, 'package.json'), JSON.stringify({ type: 'module' }))
    writeFileSync(
      join(backend, 'src/main.ts'),
      `import { readFileSync } from 'node:fs'
export const file: Buffer = readFileSync('fixture')
export async function request(): Promise<Response> {
  return fetch('https://example.invalid', { headers: new Headers(), signal: AbortSignal.timeout(5000) })
}
`
    )
    const artifact = emitNestJSProject(nestJSApplication()).find((entry) =>
      entry.path.endsWith('/tsconfig.json')
    )
    if (!artifact || typeof artifact.content !== 'string')
      throw new Error('Expected TypeScript configuration')
    const config = JSON.parse(artifact.content)
    expect(config.compilerOptions.types).toEqual(['node'])
    expect(config.compilerOptions.skipLibCheck).toBe(false)
    writeFileSync(join(backend, 'tsconfig.json'), artifact.content)
    const tsc = join(
      dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))),
      'lib/tsc.js'
    )
    const compile = () =>
      spawnSync('node', [tsc, '--noEmit', '-p', 'tsconfig.json'], {
        cwd: backend,
        encoding: 'utf8',
        timeout: 20000
      })
    const isolated = compile()
    expect(isolated.status, isolated.stdout + isolated.stderr).toBe(0)
    delete config.compilerOptions.types
    writeFileSync(join(backend, 'tsconfig.json'), JSON.stringify(config))
    const polluted = compile()
    expect(polluted.status).not.toBe(0)
    expect(polluted.stdout).toContain('foreign-framework/index.d.ts')
    expect(polluted.stdout).toContain('Cannot redeclare block-scoped variable')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30000)
