import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CODEPEN_SIDECAR_NAME,
  CODEPEN_SIDECAR_TARGETS,
  codePenSidecarBinaryHeaderMatchesTarget,
  codePenSidecarBuildCommand,
  codePenSidecarOutputPath,
  codePenSidecarTargetFromTauriEnvironment,
  parseCodePenSidecarBuildArgs,
  parseCodePenSidecarTarget
} from '#codepen-sidecar/scripts/build'

describe('CodePen sidecar packaging contract', () => {
  test('covers exactly the five desktop release targets', () => {
    expect(CODEPEN_SIDECAR_TARGETS).toEqual({
      'aarch64-apple-darwin': {
        bunTarget: 'bun-darwin-arm64',
        extension: '',
        format: 'mach-o'
      },
      'x86_64-apple-darwin': {
        bunTarget: 'bun-darwin-x64-baseline',
        extension: '',
        format: 'mach-o'
      },
      'x86_64-pc-windows-msvc': {
        bunTarget: 'bun-windows-x64-baseline',
        extension: '.exe',
        format: 'pe'
      },
      'aarch64-pc-windows-msvc': {
        bunTarget: 'bun-windows-arm64',
        extension: '.exe',
        format: 'pe'
      },
      'x86_64-unknown-linux-gnu': {
        bunTarget: 'bun-linux-x64-baseline',
        extension: '',
        format: 'elf'
      }
    })
  })

  test('derives only supported triples from Tauri hook environment values', () => {
    expect(
      codePenSidecarTargetFromTauriEnvironment({
        TAURI_ENV_PLATFORM: 'darwin',
        TAURI_ENV_ARCH: 'aarch64'
      })
    ).toBe('aarch64-apple-darwin')
    expect(
      codePenSidecarTargetFromTauriEnvironment({
        TAURI_ENV_PLATFORM: 'windows',
        TAURI_ENV_ARCH: 'x86_64'
      })
    ).toBe('x86_64-pc-windows-msvc')
    expect(() =>
      codePenSidecarTargetFromTauriEnvironment({
        TAURI_ENV_PLATFORM: 'linux',
        TAURI_ENV_ARCH: 'aarch64'
      })
    ).toThrow('Unsupported CodePen sidecar target')
  })

  test('uses the exact externalBin suffix and Windows extension', () => {
    const directory = join('desktop', 'binaries')
    expect(codePenSidecarOutputPath('aarch64-apple-darwin', directory)).toBe(
      join(directory, `${CODEPEN_SIDECAR_NAME}-aarch64-apple-darwin`)
    )
    expect(codePenSidecarOutputPath('aarch64-pc-windows-msvc', directory)).toBe(
      join(directory, `${CODEPEN_SIDECAR_NAME}-aarch64-pc-windows-msvc.exe`)
    )
  })

  test('validates executable architecture instead of accepting only container magic', () => {
    const machArm = new Uint8Array(64)
    machArm.set([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01])
    expect(codePenSidecarBinaryHeaderMatchesTarget(machArm, 'aarch64-apple-darwin')).toBeTrue()
    expect(codePenSidecarBinaryHeaderMatchesTarget(machArm, 'x86_64-apple-darwin')).toBeFalse()

    const peArm = new Uint8Array(256)
    peArm.set([0x4d, 0x5a])
    peArm[0x3c] = 0x80
    peArm.set([0x50, 0x45, 0, 0, 0x64, 0xaa], 0x80)
    expect(codePenSidecarBinaryHeaderMatchesTarget(peArm, 'aarch64-pc-windows-msvc')).toBeTrue()
    expect(codePenSidecarBinaryHeaderMatchesTarget(peArm, 'x86_64-pc-windows-msvc')).toBeFalse()

    const elf = new Uint8Array(64)
    elf.set([0x7f, 0x45, 0x4c, 0x46])
    elf.set([0x3e, 0], 18)
    expect(codePenSidecarBinaryHeaderMatchesTarget(elf, 'x86_64-unknown-linux-gnu')).toBeTrue()
  })

  test('rejects arbitrary targets and build arguments', () => {
    expect(() => parseCodePenSidecarTarget('universal-apple-darwin')).toThrow(
      'Unsupported CodePen sidecar target'
    )
    expect(() =>
      parseCodePenSidecarBuildArgs(['--output', '/tmp/attacker'], {
        TAURI_ENV_PLATFORM: 'darwin',
        TAURI_ENV_ARCH: 'aarch64'
      })
    ).toThrow('Unknown CodePen sidecar build option')
    expect(() => parseCodePenSidecarBuildArgs([], {})).toThrow('target is required')
  })

  test('disables every runtime config autoload channel in the compile command', () => {
    const command = codePenSidecarBuildCommand(
      'aarch64-pc-windows-msvc',
      'desktop/binaries/sidecar.exe'
    )
    expect(command).toContain('--no-compile-autoload-dotenv')
    expect(command).toContain('--no-compile-autoload-bunfig')
    expect(command).toContain('--no-compile-autoload-tsconfig')
    expect(command).toContain('--no-compile-autoload-package-json')
    expect(command).toContain('--windows-hide-console')
    expect(command.some((argument) => argument.includes('autoload-dotenv='))).toBeFalse()
    expect(command.at(-2)).toBe('--outfile=desktop/binaries/sidecar.exe')
  })

  test('accepts one explicit target and the verify-only operation', () => {
    expect(
      parseCodePenSidecarBuildArgs(['--target=x86_64-unknown-linux-gnu', '--verify-only'])
    ).toEqual({ target: 'x86_64-unknown-linux-gnu', verifyOnly: true })
    expect(
      parseCodePenSidecarBuildArgs([], {
        TAURI_ENV_PLATFORM: 'darwin',
        TAURI_ENV_ARCH: 'aarch64',
        OPENPENCIL_CODEPEN_SIDECAR_PREBUILT: '1'
      })
    ).toEqual({ target: 'aarch64-apple-darwin', verifyOnly: true })
  })

  test('Tauri bundles and permits only the zero-argument sidecar identity', () => {
    const config = JSON.parse(readFileSync('desktop/tauri.conf.json', 'utf8'))
    expect(config.bundle.externalBin).toEqual(['binaries/openpencil-codepen-sidecar'])
    expect(config.build.beforeBuildCommand).toContain('bun run build:codepen-sidecar')
    expect(config.build.beforeBundleCommand).toBe('bun run build:codepen-sidecar --verify-only')

    const capability = JSON.parse(readFileSync('desktop/capabilities/default.json', 'utf8'))
    const spawn = capability.permissions.find(
      (permission: unknown) =>
        typeof permission === 'object' &&
        permission !== null &&
        (permission as { identifier?: unknown }).identifier === 'shell:allow-spawn'
    )
    const sidecar = spawn.allow.find(
      (entry: { name?: string }) => entry.name === 'binaries/openpencil-codepen-sidecar'
    )
    expect(sidecar).toEqual({
      name: 'binaries/openpencil-codepen-sidecar',
      sidecar: true
    })
  })

  test('release CI builds every target and smokes every native runner', () => {
    const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
    for (const target of Object.keys(CODEPEN_SIDECAR_TARGETS)) {
      expect(workflow).toContain(`target: ${target}`)
    }
    expect(workflow).toContain('platform: macos-15-intel')
    expect(workflow).toContain('name: Smoke CodePen sidecar protocol')
    expect(workflow).toContain('if: matrix.nativeSmoke')
    expect(workflow).toContain('name: Verify signed macOS CodePen sidecar')
    expect(workflow).toContain('codesign --verify --deep --strict')
    expect(workflow).toContain('--binary="$sidecar_path"')
    expect(workflow).toContain("OPENPENCIL_CODEPEN_SIDECAR_PREBUILT: '1'")
  })

  test('root quality gates own the private sidecar source, scripts, and tests', () => {
    const packageJSON = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    for (const script of ['lint:structure', 'format']) {
      expect(packageJSON.scripts[script]).toContain('packages/codepen-sidecar/src')
      expect(packageJSON.scripts[script]).toContain('packages/codepen-sidecar/scripts')
      expect(packageJSON.scripts[script]).toContain('packages/codepen-sidecar/tests')
    }
    expect(packageJSON.scripts.lint).toContain('@open-pencil/codepen-sidecar lint')
    const sidecarPackageJSON = JSON.parse(
      readFileSync('packages/codepen-sidecar/package.json', 'utf8')
    ) as { scripts: Record<string, string> }
    for (const path of ['src', 'scripts', 'tests']) {
      expect(sidecarPackageJSON.scripts.lint).toContain(path)
    }
    expect(packageJSON.scripts['build:packages']).toContain('@open-pencil/codepen-sidecar')
    expect(packageJSON.scripts['test:unit']).toContain('packages/codepen-sidecar/tests')
    expect(packageJSON.scripts['test:coverage']).toContain('packages/codepen-sidecar/tests')
  })
})
