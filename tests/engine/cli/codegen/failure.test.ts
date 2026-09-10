import { describe, expect, test } from 'bun:test'
import { basename, dirname } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { runCodegenScenario } from './helpers'

describe('CLI codegen controlled failure and caller cleanup', () => {
  for (const failure of [
    {
      command: 'deploy',
      scenario: 'missing-file',
      target: 'react',
      message: 'A document file path is required.'
    },
    {
      command: 'deploy',
      scenario: 'no-pages',
      target: 'react',
      message: 'Document has no pages.'
    },
    {
      command: 'deploy',
      scenario: 'bad-page',
      target: 'react',
      message: 'Page "Missing page" not found. Available pages: "Page 1".'
    },
    {
      command: 'deploy',
      scenario: 'unsupported-feature',
      target: 'vue',
      message:
        'Vue v1 does not support --i18n, --locale, or --source-locale; remove those flags or use --target react.'
    },
    {
      command: 'compile',
      scenario: 'compiler-policy-error',
      target: 'react',
      message:
        'Microfrontend packaging v1 cannot safely compose: standalone HTML metadata. Remove these features or use standalone packaging.'
    },
    {
      command: 'build',
      scenario: 'compiler-policy-error',
      target: 'vue',
      message:
        'Microfrontend packaging v1 cannot safely compose: standalone HTML metadata. Remove these features or use standalone packaging.'
    }
  ] as const) {
    test(`${failure.command} returns after ${failure.target} ${failure.scenario}`, async () => {
      const result = await runCodegenScenario(failure.command, failure.scenario, failure.target)

      expect(result.exitCode).toBe(1)
      const diagnosticLines = stripVTControlCharacters(result.stderr).trim().split('\n')
      expect(diagnosticLines).toHaveLength(1)
      expect(diagnosticLines[0]).toContain(failure.message)
      expect(result.stdout).toBe('')
      expect(result.requests).toEqual([])
      expect(result.outputEntries).toEqual(['keep.txt'])
      expect(result.sentinelPreserved).toBe(true)
      expect(result.stderr).not.toContain('local-codegen-fixture-token')
      expect(result.events.filter((event) => event === 'load-document')).toHaveLength(
        failure.scenario === 'missing-file' ? 0 : 1
      )
      expect(result.temporaryEntries).toEqual([])
      expect(result.events).toContain('command-returned')
      expect(result.events).not.toContain('command-rejected')
    }, 30_000)
  }

  for (const command of ['compile', 'build', 'deploy'] as const) {
    test(`${command} preserves empty-output JSON through the defensive Compiler seam`, async () => {
      const result = await runCodegenScenario(command, 'empty-compiler-seam', 'react')

      expect(result.exitCode).toBe(1)
      const diagnosticLines = stripVTControlCharacters(result.stderr).trim().split('\n')
      expect(diagnosticLines).toHaveLength(1)
      expect(diagnosticLines[0]).toContain(
        'Compile produced no files (warnings: fixture-empty-output). Aborting before touching the output directory.'
      )
      const report = JSON.parse(result.stdout)
      expect(result.stdout).toBe(`${JSON.stringify(report, null, 2)}\n`)
      expect(report).toEqual({
        outDir: command === 'deploy' ? expect.any(String) : result.outputDirectory,
        files: [],
        warnings: [{ code: 'fixture-empty-output', message: 'Defensive empty Compiler seam' }],
        packageName: 'fixture',
        target: 'react'
      })
      if (command === 'deploy') {
        expect(dirname(report.outDir)).toBe(result.temporaryDirectory)
        expect(basename(report.outDir).startsWith('op-deploy-')).toBe(true)
      }
      expect(result.requests).toEqual([])
      expect(result.outputEntries).toEqual(['keep.txt'])
      expect(result.sentinelPreserved).toBe(true)
      expect(result.stdout + result.stderr).not.toContain('local-codegen-fixture-token')
      expect(result.events.filter((event) => event === 'empty-compiler-seam')).toHaveLength(1)
      expect(result.temporaryEntries).toEqual([])
      expect(result.events).toContain('command-returned')
      expect(result.events).not.toContain('command-rejected')
    }, 30_000)
  }

  test('deploy preserves an ordinary document rejection and still releases its temporary directory', async () => {
    const result = await runCodegenScenario('deploy', 'load-rejection', 'react')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Fixture document loading rejected')
    expect(result.stdout).toBe('')
    expect(result.events).toEqual(['load-document', 'command-rejected'])
    expect(result.requests).toEqual([])
    expect(result.outputEntries).toEqual(['keep.txt'])
    expect(result.sentinelPreserved).toBe(true)
    expect(result.temporaryEntries).toEqual([])
  }, 30_000)

  for (const command of ['compile', 'build'] as const) {
    for (const target of ['react', 'vue'] as const) {
      test(`${command} preserves successful ${target} output`, async () => {
        const result = await runCodegenScenario(command, 'success', target)

        expect(result.exitCode).toBe(0)
        expect(result.stdout + result.stderr).not.toContain('local-codegen-fixture-token')
        expect(result.requests).toEqual([])
        expect(result.events).toEqual(['load-document', 'command-returned'])
        expect(result.temporaryEntries).toEqual([])
        expect(result.outputEntries).toContain('index.html')
        const report = JSON.parse(result.stdout)
        expect(report).toMatchObject({ target, packageName: 'fixture' })
        expect(report.files).toContain('index.html')
        if (command === 'compile') {
          expect(result.outputEntries).toContain('package.json')
          expect(result.outputEntries).toContain(target === 'react' ? 'src/App.tsx' : 'src/App.vue')
        } else {
          expect(result.outputEntries.some((entry) => entry.startsWith('assets/'))).toBe(true)
        }
      }, 30_000)
    }
  }
})
