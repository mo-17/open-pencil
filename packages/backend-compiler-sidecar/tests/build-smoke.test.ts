import { describe, expect, test } from 'bun:test'
import { mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  BACKEND_COMPILER_SIDECAR_CANDIDATE_FORMAT,
  BACKEND_COMPILER_SIDECAR_TARGETS,
  acquireCandidateBuildLock,
  backendCompilerSidecarBinaryHeaderMatchesTarget,
  backendCompilerSidecarBinaryName,
  backendCompilerSidecarBuildCommand,
  backendCompilerSidecarCandidateManifestPath,
  candidateDirectoryDurability,
  backendCompilerSidecarNativeRuntimeMatchesTarget,
  backendCompilerSidecarOutputPath,
  backendCompilerSidecarTargetFromHost,
  backendCompilerSidecarTargetFromTauriEnvironment,
  buildBackendCompilerSidecar,
  parseBackendCompilerSidecarBuildArgs,
  releaseCandidateBuildLock,
  resolveBackendCompilerSidecarOutputDirectory,
  verifyBackendCompilerSidecarCandidate,
  writeBackendCompilerSidecarCandidateProvenance,
  type BackendCompilerSidecarTargetTriple
} from '../scripts/build'
import {
  backendCompilerSidecarSmokeEnvironment,
  hardKillBackendCompilerSidecar,
  parseBackendCompilerSidecarSmokeArgs,
  smokeBackendCompilerSidecar
} from '../scripts/smoke'

const MINIMUM_BINARY_BYTES = 1_000_000

interface MutableCandidateManifestV1 {
  [key: string]: unknown
  executionAuthorityCreated?: unknown
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('Expected promise to reject')
}

function syntheticBinary(target: BackendCompilerSidecarTargetTriple): Uint8Array {
  const bytes = new Uint8Array(MINIMUM_BINARY_BYTES)
  const view = new DataView(bytes.buffer)
  if (target.endsWith('apple-darwin')) {
    bytes.set([0xcf, 0xfa, 0xed, 0xfe])
    view.setUint32(4, target.startsWith('aarch64') ? 0x0100000c : 0x01000007, true)
  } else if (target.endsWith('windows-msvc')) {
    bytes.set([0x4d, 0x5a])
    view.setUint32(0x3c, 0x80, true)
    bytes.set([0x50, 0x45, 0, 0], 0x80)
    view.setUint16(0x84, target.startsWith('aarch64') ? 0xaa64 : 0x8664, true)
  } else {
    bytes.set([0x7f, 0x45, 0x4c, 0x46])
    view.setUint16(18, 0x3e, true)
  }
  bytes[bytes.byteLength - 1] = 1
  return bytes
}

async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-backend-compiler-sidecar-test-'))
  try {
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeSyntheticCandidate(
  directory: string,
  target = backendCompilerSidecarTargetFromHost()
): Promise<string> {
  const path = backendCompilerSidecarOutputPath(target, directory)
  await writeFile(path, syntheticBinary(target), { mode: 0o755 })
  await writeBackendCompilerSidecarCandidateProvenance(target, path)
  return path
}

describe('Backend Compiler sidecar candidate build contract', () => {
  test('keeps the release matrix candidate-only while building every declared target', async () => {
    const workflow = await readFile(
      resolve(import.meta.dir, '../../../.github/workflows/build.yml'),
      'utf8'
    )
    for (const target of Object.keys(BACKEND_COMPILER_SIDECAR_TARGETS)) {
      expect(workflow).toContain(`target: ${target}`)
    }
    expect(workflow).toContain('Build and verify Backend Compiler sidecar candidate')
    expect(workflow).toContain(`bun run build:backend-compiler-sidecar "\${sidecar_args[@]}"`)
    expect(workflow).toContain(
      `bun run build:backend-compiler-sidecar --target=\${{ matrix.target }} --verify-only`
    )
    expect(workflow).toContain('Smoke Backend Compiler sidecar candidate protocol')
    expect(workflow).toContain(
      `run: bun run smoke:backend-compiler-sidecar --target=\${{ matrix.target }}`
    )
    expect(workflow).not.toContain('OPENPENCIL_BACKEND_COMPILER_SIDECAR_PIN_MANIFEST')
  })

  test('maps only the supported Tauri and native targets', () => {
    expect(
      backendCompilerSidecarTargetFromTauriEnvironment({
        TAURI_ENV_PLATFORM: 'darwin',
        TAURI_ENV_ARCH: 'aarch64'
      })
    ).toBe('aarch64-apple-darwin')
    expect(
      backendCompilerSidecarTargetFromTauriEnvironment({
        TAURI_ENV_PLATFORM: 'windows',
        TAURI_ENV_ARCH: 'x86_64'
      })
    ).toBe('x86_64-pc-windows-msvc')
    expect(backendCompilerSidecarTargetFromTauriEnvironment({})).toBeNull()
    expect(() =>
      backendCompilerSidecarTargetFromTauriEnvironment({
        TAURI_ENV_PLATFORM: 'linux',
        TAURI_ENV_ARCH: 'aarch64'
      })
    ).toThrow('Unsupported Backend Compiler sidecar target')
    expect(
      backendCompilerSidecarNativeRuntimeMatchesTarget(backendCompilerSidecarTargetFromHost())
    ).toBeTrue()
    expect(
      backendCompilerSidecarNativeRuntimeMatchesTarget('aarch64-pc-windows-msvc', 'linux', 'x64')
    ).toBeFalse()
  })

  test('recognizes exact executable headers for every declared target', () => {
    for (const target of Object.keys(
      BACKEND_COMPILER_SIDECAR_TARGETS
    ) as BackendCompilerSidecarTargetTriple[]) {
      expect(
        backendCompilerSidecarBinaryHeaderMatchesTarget(syntheticBinary(target), target)
      ).toBeTrue()
    }
    expect(
      backendCompilerSidecarBinaryHeaderMatchesTarget(
        syntheticBinary('aarch64-apple-darwin'),
        'x86_64-apple-darwin'
      )
    ).toBeFalse()
    expect(
      backendCompilerSidecarBinaryHeaderMatchesTarget(
        syntheticBinary('x86_64-pc-windows-msvc'),
        'aarch64-pc-windows-msvc'
      )
    ).toBeFalse()
    expect(
      backendCompilerSidecarBinaryHeaderMatchesTarget(new Uint8Array(63), 'aarch64-apple-darwin')
    ).toBeFalse()
  })

  test('pins the hardened Bun compile command without ambient config autoload', () => {
    const target = 'aarch64-apple-darwin'
    const command = backendCompilerSidecarBuildCommand(target, '/tmp/candidate', false)
    expect(command.slice(0, 4)).toEqual([
      process.execPath,
      'build',
      '--compile',
      '--target=bun-darwin-arm64'
    ])
    expect(command).toContain('--no-compile-autoload-dotenv')
    expect(command).toContain('--no-compile-autoload-bunfig')
    expect(command).toContain('--no-compile-autoload-tsconfig')
    expect(command).toContain('--no-compile-autoload-package-json')
    expect(command).toContain('--minify')
    expect(command.at(-1)).toBe('--outfile=/tmp/candidate')
    expect(backendCompilerSidecarBuildCommand(target, '/tmp/candidate', true)).not.toContain(
      '--target=bun-darwin-arm64'
    )
  })

  test('parses explicit build options and rejects authority-expanding arguments', () => {
    const options = parseBackendCompilerSidecarBuildArgs(
      ['--target=x86_64-unknown-linux-gnu', '--verify-only'],
      {}
    )
    expect(options).toEqual({
      target: 'x86_64-unknown-linux-gnu',
      verifyOnly: true,
      nativeRuntime: false
    })
    expect(() => parseBackendCompilerSidecarBuildArgs([], {})).toThrow(
      'target is required outside a Tauri build hook'
    )
    expect(() =>
      parseBackendCompilerSidecarBuildArgs(
        ['--target=x86_64-unknown-linux-gnu', '--verify-only', '--native-runtime'],
        {}
      )
    ).toThrow('--native-runtime is only valid while building')
    expect(() =>
      parseBackendCompilerSidecarBuildArgs(
        ['--target=x86_64-unknown-linux-gnu', '--credential=forbidden'],
        {}
      )
    ).toThrow('Unknown Backend Compiler sidecar build option')
    expect(resolveBackendCompilerSidecarOutputDirectory('relative-output', '/work/project')).toBe(
      resolve('/work/project/relative-output')
    )
  })

  test('serializes each target build with an explicit fail-closed lock', async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = backendCompilerSidecarTargetFromHost()
      const lock = await acquireCandidateBuildLock(target, directory)
      expect(await rejectionMessage(acquireCandidateBuildLock(target, directory))).toContain(
        'candidate build is locked'
      )
      await releaseCandidateBuildLock(lock, directory)
      const next = await acquireCandidateBuildLock(target, directory)
      await releaseCandidateBuildLock(next, directory)
      expect(await readdir(directory)).toEqual([])
    })
  })

  test('makes Windows directory durability limits explicit without widening authority', () => {
    expect(candidateDirectoryDurability('darwin')).toBe('directory-fsync')
    expect(candidateDirectoryDurability('linux')).toBe('directory-fsync')
    expect(candidateDirectoryDurability('win32')).toBe('manifest-digest-fail-closed')
  })
})

describe('Backend Compiler sidecar candidate provenance', () => {
  test('writes only the exact canonical candidate schema and rehashes on verify', async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = backendCompilerSidecarTargetFromHost()
      const binaryPath = await writeSyntheticCandidate(directory, target)
      const manifestPath = backendCompilerSidecarCandidateManifestPath(binaryPath)
      const manifestText = await readFile(manifestPath, 'utf8')
      const manifest = await verifyBackendCompilerSidecarCandidate(target, binaryPath)

      expect(manifestText).toBe(`${JSON.stringify(manifest)}\n`)
      expect(Object.keys(manifest)).toEqual([
        'byteLength',
        'binaryName',
        'executionAuthorityCreated',
        'format',
        'protocolVersion',
        'registryIssuerAuthorityCreated',
        'releaseAuthorityCreated',
        'sha256',
        'target',
        'version'
      ])
      expect(manifest).toMatchObject({
        byteLength: MINIMUM_BINARY_BYTES,
        binaryName: backendCompilerSidecarBinaryName(target),
        executionAuthorityCreated: false,
        format: BACKEND_COMPILER_SIDECAR_CANDIDATE_FORMAT,
        protocolVersion: 1,
        registryIssuerAuthorityCreated: false,
        releaseAuthorityCreated: false,
        target,
        version: 1
      })
      expect(manifest.sha256).toMatch(/^[A-Za-z0-9_-]{43}$/)

      const binary = await open(binaryPath, 'r+')
      try {
        await binary.write(Uint8Array.of(2), 0, 1, MINIMUM_BINARY_BYTES - 1)
      } finally {
        await binary.close()
      }
      expect(
        await rejectionMessage(verifyBackendCompilerSidecarCandidate(target, binaryPath))
      ).toContain('does not match the binary')
    })
  })

  test('rejects noncanonical, authority-bearing, renamed, and symlink candidates', async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = backendCompilerSidecarTargetFromHost()
      const binaryPath = await writeSyntheticCandidate(directory, target)
      const manifestPath = backendCompilerSidecarCandidateManifestPath(binaryPath)
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as MutableCandidateManifestV1
      parsed.executionAuthorityCreated = true
      await writeFile(manifestPath, `${JSON.stringify(parsed)}\n`)
      expect(
        await rejectionMessage(verifyBackendCompilerSidecarCandidate(target, binaryPath))
      ).toContain('candidate provenance is invalid')

      const renamed = join(directory, `renamed-${backendCompilerSidecarBinaryName(target)}`)
      expect(
        await rejectionMessage(verifyBackendCompilerSidecarCandidate(target, renamed))
      ).toContain('binary name is not canonical')
    })

    if (process.platform !== 'win32') {
      await withTemporaryDirectory(async (directory) => {
        const target = backendCompilerSidecarTargetFromHost()
        const binaryPath = backendCompilerSidecarOutputPath(target, directory)
        const realPath = join(directory, 'real-binary')
        await writeFile(realPath, syntheticBinary(target), { mode: 0o755 })
        await symlink(realPath, binaryPath)
        expect(
          await rejectionMessage(writeBackendCompilerSidecarCandidateProvenance(target, binaryPath))
        ).toContain('regular non-symlink')
      })
    }
  })
})

describe('Backend Compiler sidecar candidate smoke boundary', () => {
  test('accepts only an exact target-named candidate and bounded timeout', () => {
    const target = backendCompilerSidecarTargetFromHost()
    const binary = backendCompilerSidecarOutputPath(target, join(tmpdir(), 'backend-sidecar-smoke'))
    expect(
      parseBackendCompilerSidecarSmokeArgs([
        `--target=${target}`,
        `--binary=${binary}`,
        '--timeout-ms=1234'
      ])
    ).toEqual({ target, binaryPath: binary, timeoutMs: 1234 })
    expect(() => parseBackendCompilerSidecarSmokeArgs([])).toThrow('requires --target')
    expect(() =>
      parseBackendCompilerSidecarSmokeArgs([`--target=${target}`, '--binary=/tmp/renamed-sidecar'])
    ).toThrow('candidate must be named')
    expect(() =>
      parseBackendCompilerSidecarSmokeArgs([`--target=${target}`, '--timeout-ms=0'])
    ).toThrow('positive integer')
    expect(() =>
      parseBackendCompilerSidecarSmokeArgs([`--target=${target}`, '--timeout-ms=30001'])
    ).toThrow('must not exceed 30000')
  })

  test('uses a fixed minimal environment and explicit Windows infrastructure paths', () => {
    const directory = resolve(tmpdir(), 'backend-sidecar-smoke-environment')
    expect(backendCompilerSidecarSmokeEnvironment(directory, 'darwin', {})).toEqual({
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC'
    })
    expect(
      backendCompilerSidecarSmokeEnvironment('C:\\Temp\\backend-sidecar-smoke', 'win32', {
        SystemRoot: 'C:\\Windows',
        SECRET: 'must-not-cross'
      })
    ).toEqual({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp\\backend-sidecar-smoke',
      TMP: 'C:\\Temp\\backend-sidecar-smoke'
    })
    expect(() => backendCompilerSidecarSmokeEnvironment('relative', 'linux', {})).toThrow(
      'must be an absolute path'
    )
    expect(() =>
      backendCompilerSidecarSmokeEnvironment('C:\\Temp\\backend-sidecar-smoke', 'win32', {})
    ).toThrow('requires an absolute Windows SystemRoot')
  })

  test('hard-kills a subprocess that ignores the graceful termination signal', async () => {
    if (process.platform === 'win32') return
    const child = Bun.spawn(['/bin/sh', '-c', `trap '' TERM; while :; do :; done`], {
      detached: true,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore'
    })
    try {
      await Bun.sleep(20)
      child.kill()
      const ignored = await Promise.race([
        child.exited.then(() => false),
        Bun.sleep(50).then(() => true)
      ])
      expect(ignored).toBeTrue()
    } finally {
      await hardKillBackendCompilerSidecar(child)
    }
  })
})

const binaryTest =
  process.env.OPENPENCIL_BACKEND_COMPILER_SIDECAR_BINARY_TEST === '1' ? test : test.skip

binaryTest(
  'builds, rehashes, and smokes the real current-host candidate in a temporary directory',
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = backendCompilerSidecarTargetFromHost()
      const first = await buildBackendCompilerSidecar(target, true, directory)
      const manifest = await buildBackendCompilerSidecar(target, true, directory)
      expect(manifest).toEqual(first)
      expect((await readdir(directory)).sort()).toEqual(
        [
          backendCompilerSidecarBinaryName(target),
          backendCompilerSidecarCandidateManifestPath(
            backendCompilerSidecarOutputPath(target, directory)
          ).slice(directory.length + 1)
        ].sort()
      )
      expect(manifest.releaseAuthorityCreated).toBeFalse()
      expect(
        await smokeBackendCompilerSidecar({
          target,
          binaryPath: backendCompilerSidecarOutputPath(target, directory),
          timeoutMs: 30_000
        })
      ).toEqual(manifest)
    })
  },
  180_000
)
