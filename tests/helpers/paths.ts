import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function repoPath(...segments: string[]): string {
  return join(repoRoot, ...segments)
}

export function coreSourcePath(...segments: string[]): string {
  return repoPath('packages/core/src', ...segments)
}

export function cliSourcePath(...segments: string[]): string {
  return repoPath('packages/cli/src', ...segments)
}

export function testPath(...segments: string[]): string {
  return repoPath('tests', ...segments)
}

export function publicPath(...segments: string[]): string {
  return repoPath('public', ...segments)
}

export function requireBuiltWorkspacePackages(): void {
  const coreDist = repoPath('packages/core/dist/index.js')
  if (!existsSync(coreDist)) {
    throw new Error(
      'CLI integration tests require built workspace packages. Run `bun run check` or `bun run --filter @open-pencil/core build` first.'
    )
  }
}
