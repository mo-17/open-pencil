import { expect, test } from 'bun:test'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..')
const SECRET_SCAN_ENTRY = resolve(import.meta.dir, '../src/index.ts')
const STRICT_CONFIG = resolve(REPOSITORY_ROOT, '.gitleaks.toml')
const LOCAL_CONFIG = resolve(REPOSITORY_ROOT, '.gitleaks.local.toml')
const PRIVATE_KEY_LABEL = ['PRIVATE', 'KEY'].join(' ')
const SYNTHETIC_PRIVATE_KEY = [
  '-----BEGIN OPENSSH ' + PRIVATE_KEY_LABEL + '-----',
  'c3ludGhldGljLXRlc3QtZml4dHVyZS1ub3QtYS1yZWFsLWtleQ==',
  '-----END OPENSSH ' + PRIVATE_KEY_LABEL + '-----',
  ''
].join('\n')
const SYNTHETIC_GITHUB_PAT = [
  'ghp',
  '_',
  'a1B2c3D4',
  'e5F6g7H8',
  'i9J0k1L2',
  'm3N4o5P6',
  'q7R8'
].join('')
const EXACT_GOOGLE_FONTS_KEY = ['AIzaSyD1', 'tYDR_dUE', 'iV-Tw1vk', 'sEhZbUyt', 'gKW5pc8'].join('')
const EXACT_MARKETPLACE_TYPE = ['Marketplace', 'Publisher', 'KeyV1'].join('')
const EXACT_MARKETPLACE_PUBLISHER_TYPE = ['Marketplace', 'Publisher', 'V1'].join('')
const EXACT_OPENROUTER_KEY = ['sk-or-', 'test-key', '-12345'].join('')
const EXACT_SUPABASE_JWT = ['eyJhbGci', 'OiJIUzI1', 'NiJ9', '.anon', '.sig'].join('')
const EXACT_COMPONENT_KEY = ['26164e02', '9c485511', 'adfa6345', '22024c7c', '23e7bb81'].join('')
const EXACT_FILE_KEY = ['jSxlQDCr', 'jsvqEQq1', '7IWEcC'].join('')
const EXACT_ALLOWLIST_FIXTURE = [
  "const googleFontsKey = '" + EXACT_GOOGLE_FONTS_KEY + "'",
  "const keybinding = '$mod+Shift+KeyZ'",
  "const publisherType = '" + EXACT_MARKETPLACE_TYPE + "'",
  "const publisherRecordType = '" + EXACT_MARKETPLACE_PUBLISHER_TYPE + "'",
  "const openRouterKey = '" + EXACT_OPENROUTER_KEY + "'",
  "const supabaseAnon = '" + EXACT_SUPABASE_JWT + "'",
  "const componentKey = '" + EXACT_COMPONENT_KEY + "'",
  "const fileKey = '" + EXACT_FILE_KEY + "'",
  ''
].join('\n')
const PREVIOUSLY_ALLOWLISTED_PATHS = [
  'packages/core/src/constants.ts',
  'packages/vue/src/editor/commands/registry.ts',
  'packages/core/src/plugins/marketplace/directory.ts',
  'packages/marketplace/src/publication.ts',
  'tests/e2e/chat/panel.spec.ts',
  'tests/engine/compiler/adapters/react/supabase-auth-emit.test.ts',
  'tests/engine/compiler/cross-walker/supabase.test.ts',
  'tests/engine/tools/lowcode/cross-walker.test.ts',
  'tests/engine/io/fig/heavy/component-metadata.test.ts',
  'tests/fixtures/figma-oracles/probe.json'
] as const
const WEAK_STRICT_CONFIG = [
  'title = "Synthetic weak configuration"',
  '',
  '[extend]',
  'useDefault = true',
  '',
  '[[allowlists]]',
  'description = "Synthetic unsafe path allowlist"',
  "paths = ['''.*''']",
  ''
].join('\n')

function run(command: string, args: string[], cwd: string): Bun.SpawnSyncReturns<Buffer> {
  return Bun.spawnSync([command, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  })
}

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'open-pencil-secret-policy-'))
  if (!run('git', ['init', '-q'], root).success) {
    throw new Error('Failed to initialize secret-scan Git fixture')
  }
  copyFileSync(STRICT_CONFIG, join(root, '.gitleaks.toml'))
  copyFileSync(LOCAL_CONFIG, join(root, '.gitleaks.local.toml'))
  writeFileSync(join(root, '.gitignore'), ['.env', '*.local', 'dist/', ''].join('\n'))
  const staged = run('git', ['add', '.gitignore', '.gitleaks.toml', '.gitleaks.local.toml'], root)
  if (!staged.success) throw new Error('Failed to initialize secret-scan Git fixture')
  return root
}

function scan(root: string): Bun.SpawnSyncReturns<Buffer> {
  return run('bun', [SECRET_SCAN_ENTRY], root)
}

test('strict config keeps generated-directory exclusions out of the commit scan', () => {
  const strictConfig = readFileSync(STRICT_CONFIG, 'utf8')
  const localConfig = readFileSync(LOCAL_CONFIG, 'utf8')

  expect(strictConfig).not.toContain('Local and generated artifacts')
  expect(strictConfig).not.toContain('paths = [')
  expect(strictConfig).not.toContain('regexTarget = "line"')
  expect(strictConfig).not.toContain('regexTarget = "match"')
  expect(strictConfig).toContain('regexTarget = "secret"')
  expect(localConfig).toContain('Uncommitted and generated local artifacts')
  expect(localConfig).toContain("'''(^|/)dist/'''")
  expect(localConfig).not.toContain("'''(^|/)\\.env$'''")
})

test.skipIf(Bun.which('gitleaks') === null)(
  'fails for every commit authority while allowing ignored local state',
  () => {
    const ignoredRoot = createFixture()
    try {
      writeFileSync(join(ignoredRoot, 'credential.local'), SYNTHETIC_PRIVATE_KEY)
      expect(scan(ignoredRoot).exitCode).toBe(0)
    } finally {
      rmSync(ignoredRoot, { force: true, recursive: true })
    }

    const envRoot = createFixture()
    try {
      writeFileSync(join(envRoot, '.env'), SYNTHETIC_PRIVATE_KEY)
      expect(run('git', ['add', '-f', '.env'], envRoot).success).toBeTrue()
      expect(scan(envRoot).exitCode).not.toBe(0)
    } finally {
      rmSync(envRoot, { force: true, recursive: true })
    }

    const indexOnlyRoot = createFixture()
    try {
      writeFileSync(join(indexOnlyRoot, '.env'), SYNTHETIC_PRIVATE_KEY)
      expect(run('git', ['add', '-f', '.env'], indexOnlyRoot).success).toBeTrue()
      writeFileSync(join(indexOnlyRoot, '.env'), 'SAFE_LOCAL_VALUE=1\n')
      expect(scan(indexOnlyRoot).exitCode).not.toBe(0)
    } finally {
      rmSync(indexOnlyRoot, { force: true, recursive: true })
    }

    const distRoot = createFixture()
    try {
      mkdirSync(join(distRoot, 'dist'))
      writeFileSync(join(distRoot, 'dist/credential.txt'), SYNTHETIC_PRIVATE_KEY)
      expect(run('git', ['add', '-f', 'dist/credential.txt'], distRoot).success).toBeTrue()
      expect(scan(distRoot).exitCode).not.toBe(0)
    } finally {
      rmSync(distRoot, { force: true, recursive: true })
    }

    const intentRoot = createFixture()
    try {
      writeFileSync(join(intentRoot, '.env'), SYNTHETIC_PRIVATE_KEY)
      expect(run('git', ['add', '-N', '-f', '.env'], intentRoot).success).toBeTrue()
      expect(scan(intentRoot).exitCode).not.toBe(0)
    } finally {
      rmSync(intentRoot, { force: true, recursive: true })
    }

    if (process.platform !== 'win32') {
      const symlinkRoot = createFixture()
      try {
        symlinkSync(SYNTHETIC_PRIVATE_KEY, join(symlinkRoot, 'credential-link'))
        expect(run('git', ['add', 'credential-link'], symlinkRoot).success).toBeTrue()
        expect(scan(symlinkRoot).exitCode).not.toBe(0)
      } finally {
        rmSync(symlinkRoot, { force: true, recursive: true })
      }
    }

    const weakWorkingConfigRoot = createFixture()
    try {
      writeFileSync(join(weakWorkingConfigRoot, '.env'), SYNTHETIC_PRIVATE_KEY)
      expect(run('git', ['add', '-f', '.env'], weakWorkingConfigRoot).success).toBeTrue()
      writeFileSync(join(weakWorkingConfigRoot, '.env'), 'SAFE_LOCAL_VALUE=1\n')
      writeFileSync(join(weakWorkingConfigRoot, '.gitleaks.toml'), WEAK_STRICT_CONFIG)
      expect(scan(weakWorkingConfigRoot).exitCode).not.toBe(0)
    } finally {
      rmSync(weakWorkingConfigRoot, { force: true, recursive: true })
    }

    const weakIndexConfigRoot = createFixture()
    try {
      writeFileSync(join(weakIndexConfigRoot, '.gitleaks.toml'), WEAK_STRICT_CONFIG)
      writeFileSync(join(weakIndexConfigRoot, '.env'), SYNTHETIC_PRIVATE_KEY)
      expect(
        run('git', ['add', '-f', '.gitleaks.toml', '.env'], weakIndexConfigRoot).success
      ).toBeTrue()
      copyFileSync(STRICT_CONFIG, join(weakIndexConfigRoot, '.gitleaks.toml'))
      writeFileSync(join(weakIndexConfigRoot, '.env'), 'SAFE_LOCAL_VALUE=1\n')
      expect(scan(weakIndexConfigRoot).exitCode).not.toBe(0)
    } finally {
      rmSync(weakIndexConfigRoot, { force: true, recursive: true })
    }
  },
  90_000
)

test.skipIf(Bun.which('gitleaks') === null)(
  'never suppresses an unrelated secret in any formerly allowlisted path',
  () => {
    for (const path of PREVIOUSLY_ALLOWLISTED_PATHS) {
      const root = createFixture()
      try {
        const destination = join(root, path)
        mkdirSync(resolve(destination, '..'), { recursive: true })
        writeFileSync(destination, SYNTHETIC_PRIVATE_KEY)
        expect(run('git', ['add', '-f', path], root).success).toBeTrue()
        expect(scan(root).exitCode).not.toBe(0)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  },
  90_000
)

test.skipIf(Bun.which('gitleaks') === null)(
  'allows only exact inert values and still detects another token on the same line',
  () => {
    const safeRoot = createFixture()
    try {
      writeFileSync(join(safeRoot, 'known-safe-fixtures.ts'), EXACT_ALLOWLIST_FIXTURE)
      expect(run('git', ['add', 'known-safe-fixtures.ts'], safeRoot).success).toBeTrue()
      expect(scan(safeRoot).exitCode).toBe(0)
    } finally {
      rmSync(safeRoot, { force: true, recursive: true })
    }

    const mixedRoot = createFixture()
    try {
      writeFileSync(
        join(mixedRoot, 'mixed.ts'),
        "const publicKey = '" +
          EXACT_GOOGLE_FONTS_KEY +
          "'; " +
          "const token = '" +
          SYNTHETIC_GITHUB_PAT +
          "'\n"
      )
      expect(run('git', ['add', 'mixed.ts'], mixedRoot).success).toBeTrue()
      expect(scan(mixedRoot).exitCode).not.toBe(0)
    } finally {
      rmSync(mixedRoot, { force: true, recursive: true })
    }
  },
  30_000
)
