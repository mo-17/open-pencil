import { describe, expect, test } from 'bun:test'

import {
  buildMicrofrontendExportArgs,
  defaultMicrofrontendAppId,
  microfrontendAppIdError,
  microfrontendVersionError,
  parseMicrofrontendExportResult,
  type MicrofrontendExportCommandOptions
} from '@/app/lowcode/preview-pane/microfrontend-export/command'

const MAX_CLI_OUTPUT_BYTES = 1024 * 1024
const VALID_MANIFEST_DIGEST = 'A'.repeat(43)

function commandOptions(
  overrides: Partial<MicrofrontendExportCommandOptions> = {}
): MicrofrontendExportCommandOptions {
  return {
    snapshotPath: '/tmp/open-pencil snapshot.fig',
    outDir: '/tmp/open-pencil build',
    target: 'react',
    appId: 'acme.orders',
    version: '1.2.3',
    packageName: 'orders-app',
    uiKit: 'none',
    ...overrides
  }
}

function resultFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outDir: '/exports/orders',
    packageName: 'orders-app',
    target: 'react',
    files: [
      'assets/openpencil-microfrontend.js',
      'assets/openpencil-microfrontend.css',
      'openpencil.microfrontend.json'
    ],
    warnings: [{ code: 'review-required', message: 'Review the generated behavior.' }],
    microfrontend: {
      manifest: { digest: VALID_MANIFEST_DIGEST, byteLength: 512 }
    },
    ...overrides
  }
}

describe('microfrontend export command identity', () => {
  test('derives a stable default app ID from the document name', () => {
    expect(defaultMicrofrontendAppId(' Demo / Orders App ')).toBe('openpencil.demo-orders-app')
    expect(defaultMicrofrontendAppId('---')).toBe('openpencil.openpencil-app')
    expect(defaultMicrofrontendAppId('惊悚 乐园')).toMatch(/^openpencil\.openpencil-app-[a-z0-9]+$/)
  })

  test('accepts bounded module identities and rejects malformed app IDs', () => {
    expect(microfrontendAppIdError(' acme.orders-app_2 ')).toBeNull()

    for (const value of ['', 'Acme.Orders', 'acme orders', '.acme', 'acme..orders']) {
      expect(microfrontendAppIdError(value)).not.toBeNull()
    }
    expect(microfrontendAppIdError('a'.repeat(129))).toContain('maximum length of 128')
  })

  test('accepts only stable major.minor.patch versions', () => {
    expect(microfrontendVersionError(' 0.0.0 ')).toBeNull()
    expect(microfrontendVersionError('12.34.56')).toBeNull()

    for (const value of ['', '1', '1.2', 'v1.2.3', '1.2.3-beta.1', '01.2.3']) {
      expect(microfrontendVersionError(value)).toContain('stable semantic version')
    }
  })
})

describe('microfrontend export CLI arguments', () => {
  test('builds the exact React argv and includes shadcn only when selected', () => {
    expect(buildMicrofrontendExportArgs(commandOptions({ uiKit: 'shadcn' }))).toEqual([
      'packages/cli/src/index.ts',
      'build',
      '/tmp/open-pencil snapshot.fig',
      '-o',
      '/tmp/open-pencil build',
      '--target',
      'react',
      '--packaging',
      'microfrontend',
      '--app-id',
      'acme.orders',
      '--app-version',
      '1.2.3',
      '--package-name',
      'orders-app',
      '--base',
      './',
      '--json',
      '--ui-kit',
      'shadcn'
    ])
  })

  test('builds Vue argv without forwarding the React-only shadcn option', () => {
    const args = buildMicrofrontendExportArgs(commandOptions({ target: 'vue', uiKit: 'shadcn' }))

    expect(args).toEqual([
      'packages/cli/src/index.ts',
      'build',
      '/tmp/open-pencil snapshot.fig',
      '-o',
      '/tmp/open-pencil build',
      '--target',
      'vue',
      '--packaging',
      'microfrontend',
      '--app-id',
      'acme.orders',
      '--app-version',
      '1.2.3',
      '--package-name',
      'orders-app',
      '--base',
      './',
      '--json'
    ])
    expect(args).not.toContain('--ui-kit')
  })

  test('keeps paths and package names as individual argv entries instead of shell text', () => {
    const snapshotPath = '/tmp/design $(touch should-not-run).fig'
    const outDir = '/tmp/output; echo should-not-run'
    const packageName = 'orders package && should-not-run'
    const args = buildMicrofrontendExportArgs(commandOptions({ snapshotPath, outDir, packageName }))

    expect(Array.isArray(args)).toBe(true)
    expect(args[args.indexOf('build') + 1]).toBe(snapshotPath)
    expect(args[args.indexOf('-o') + 1]).toBe(outDir)
    expect(args[args.indexOf('--package-name') + 1]).toBe(packageName)
    expect(args).not.toContain(args.join(' '))
  })
})

describe('microfrontend export CLI result', () => {
  test('parses a bounded successful JSON result', () => {
    expect(parseMicrofrontendExportResult(JSON.stringify(resultFixture()))).toEqual({
      outDir: '/exports/orders',
      packageName: 'orders-app',
      target: 'react',
      files: [
        'assets/openpencil-microfrontend.js',
        'assets/openpencil-microfrontend.css',
        'openpencil.microfrontend.json'
      ],
      warningCount: 1,
      manifestDigest: VALID_MANIFEST_DIGEST,
      manifestByteLength: 512
    })
  })

  test('rejects empty and malformed JSON output', () => {
    expect(() => parseMicrofrontendExportResult('')).toThrow(
      'Microfrontend build output is empty or too large.'
    )
    expect(() => parseMicrofrontendExportResult('{')).toThrow(
      'Could not parse microfrontend build output.'
    )
    expect(() => parseMicrofrontendExportResult('[]')).toThrow(
      'Microfrontend build output must be an object.'
    )
  })

  test('requires the runtime manifest summary', () => {
    const missingMicrofrontend = resultFixture()
    delete missingMicrofrontend.microfrontend
    expect(() => parseMicrofrontendExportResult(JSON.stringify(missingMicrofrontend))).toThrow(
      'Microfrontend build output is missing its runtime manifest summary.'
    )

    expect(() =>
      parseMicrofrontendExportResult(JSON.stringify(resultFixture({ microfrontend: {} })))
    ).toThrow('Microfrontend build output is missing its runtime manifest summary.')
  })

  test('rejects malformed manifest digests', () => {
    for (const digest of ['short', `${'A'.repeat(42)}+`, 'A'.repeat(44)]) {
      expect(() =>
        parseMicrofrontendExportResult(
          JSON.stringify(
            resultFixture({ microfrontend: { manifest: { digest, byteLength: 512 } } })
          )
        )
      ).toThrow('Microfrontend build output has an invalid manifest digest.')
    }
  })

  test('measures the output limit in UTF-8 bytes for multibyte JSON', () => {
    const raw = JSON.stringify(
      resultFixture({ outDir: '界'.repeat(Math.floor(MAX_CLI_OUTPUT_BYTES / 3) + 1) })
    )

    expect(raw.length).toBeLessThan(MAX_CLI_OUTPUT_BYTES)
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(MAX_CLI_OUTPUT_BYTES)
    expect(() => parseMicrofrontendExportResult(raw)).toThrow(
      'Microfrontend build output is empty or too large.'
    )
  })

  test('rejects oversized output, collections, and manifest summaries', () => {
    expect(() => parseMicrofrontendExportResult('x'.repeat(MAX_CLI_OUTPUT_BYTES + 1))).toThrow(
      'Microfrontend build output is empty or too large.'
    )
    expect(() =>
      parseMicrofrontendExportResult(
        JSON.stringify(resultFixture({ files: Array.from({ length: 4097 }, () => 'a') }))
      )
    ).toThrow('Microfrontend build output has an invalid file list.')
    expect(() =>
      parseMicrofrontendExportResult(
        JSON.stringify(resultFixture({ warnings: Array.from({ length: 4097 }, () => null) }))
      )
    ).toThrow('Microfrontend build output has an invalid warning list.')
    expect(() =>
      parseMicrofrontendExportResult(
        JSON.stringify(
          resultFixture({
            microfrontend: {
              manifest: {
                digest: VALID_MANIFEST_DIGEST,
                byteLength: MAX_CLI_OUTPUT_BYTES + 1
              }
            }
          })
        )
      )
    ).toThrow('Microfrontend build output has an invalid manifest byte length.')
  })
})
