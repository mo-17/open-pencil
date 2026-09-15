import { expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildPreviewProject, type BuildResult } from '@open-pencil/compiler/build'

import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'

import { businessBrowserFixture } from '../browser/helpers'

interface BusinessStaticExport {
  readonly fixture: Awaited<ReturnType<typeof businessBrowserFixture>>
  readonly result: BuildResult
  readonly staticJavaScript: string
  readonly directory: string
}

export async function withBusinessStaticExport(
  kind: BusinessTemplateId,
  target: 'react' | 'vue',
  verify: (built: BusinessStaticExport) => void
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-business-export-'))
  try {
    const fixture = await businessBrowserFixture(kind, target)
    const result = await buildPreviewProject({
      target,
      // The browser fixture also exposes a session stub; static exports must use
      // the original compiler output, including the generated OIDC implementation.
      files: fixture.output.files,
      artifactOwnership: fixture.output.artifactOwnership,
      outDir: directory
    })
    expect(result.staticFiles).toContain('index.html')
    expect(result.staticFiles.some((path) => path.endsWith('.js'))).toBe(true)
    expect(result.staticFiles.some((path) => path.startsWith('openpencil-server/'))).toBe(false)
    expect(fixture.output.files.get('src/lowcode-backend-auth.ts')).toContain(
      'calculatePKCECodeChallenge'
    )
    const staticJavaScript = result.staticFiles
      .filter((path) => path.endsWith('.js'))
      .map((path) => readFileSync(join(directory, path), 'utf8'))
      .join('\n')
    expect(staticJavaScript).not.toContain('business-test-session')
    verify({ fixture, result, staticJavaScript, directory })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function expectServerSource(built: BusinessStaticExport, sourcePath: string): void {
  const outputPath = built.result.serverFiles.find((path) => path.endsWith('/' + sourcePath))
  expect(outputPath).toBeDefined()
  if (!outputPath) throw new Error('Missing server-only artifact: ' + sourcePath)
  expect(built.result.staticFiles).not.toContain(outputPath)
  expect(readFileSync(join(built.directory, outputPath), 'utf8')).toBe(
    built.fixture.output.files.get(sourcePath)
  )
}
