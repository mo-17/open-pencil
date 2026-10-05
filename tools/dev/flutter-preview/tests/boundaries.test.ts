import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  prepareOfflineAndroid,
  OFFLINE_GRADLE_WRAPPER,
  gradleCachedDistribution
} from '../src/android-offline'
import { validateOfflineDependencies } from '../src/dependencies'
import { boundedLines } from '../src/lines'
import { OwnedFlutterProject, validateGeneratedFiles } from '../src/owned-project'
import {
  createFlutterArguments,
  flutterEnvironment,
  parseFlutterDevices,
  runFlutterArguments
} from '../src/sdk'
import { FakeProject, generated, testSDK } from './helpers/index'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})
async function ownedProject() {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-flutter-preview-test-'))
  temporaryDirectories.push(directory)
  return OwnedFlutterProject.create({ temporaryDirectory: directory })
}
async function* chunks(values: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* values
}

describe('native runner input and owned output boundaries', () => {
  test('UTF-8 chunks and CRLF are framed before parsing, with a byte limit', async () => {
    const bytes = Buffer.from('中文\r\nsecond\n')
    const lines: string[] = []
    for await (const line of boundedLines(
      chunks([bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)]),
      8
    ))
      lines.push(line)
    expect(lines).toEqual(['中文', 'second'])
    await expect(Array.fromAsync(boundedLines(chunks([Buffer.from('12345')]), 4))).rejects.toThrow(
      'line byte budget'
    )
    await expect(
      Array.fromAsync(boundedLines(chunks([Uint8Array.of(255, 10)]), 10))
    ).rejects.toBeInstanceOf(TypeError)
  })

  test('rejects traversal, arbitrary native files and oversized compiler output', () => {
    for (const path of [
      '../unowned.dart',
      '/outside.dart',
      'lib/../outside.dart',
      'lib//main.dart',
      'lib\\main.dart',
      'ios/Runner/main.swift'
    ]) {
      const files = generated()
      files.set(path, 'unexpected')
      expect(() => validateGeneratedFiles(files)).toThrow()
    }
    const files = generated()
    files.set('lib/large.dart', 'x'.repeat(4 * 1024 * 1024 + 1))
    expect(() => validateGeneratedFiles(files)).toThrow('byte budget')
  })

  test('writes only a private UUID session, guards expected contents and retains logs', async () => {
    const project = await ownedProject()
    expect(project.directory.endsWith(project.sessionId)).toBe(true)
    const previous = generated('initial')
    await project.write(previous)
    await writeFile(join(project.directory, 'lib/main.dart'), 'external edit')
    await expect(project.write(generated('edited'), previous)).rejects.toThrow('changed outside')
    expect(await readFile(join(project.directory, 'lib/main.dart'), 'utf8')).toBe('external edit')
    await project.log('owned', 'private log')
    expect(await readFile(join(project.directory, '.openpencil/logs/owned.log'), 'utf8')).toBe(
      'private log'
    )
  })

  test('rejects a symlink parent before touching an outside file', async () => {
    const project = await ownedProject()
    const outside = join(project.directory, '..', 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'main.dart'), 'preserved')
    await symlink(outside, join(project.directory, 'lib'))
    await expect(project.write(generated('changed'))).rejects.toThrow('symlink')
    expect(await readFile(join(outside, 'main.dart'), 'utf8')).toBe('preserved')
  })

  test('rejects a leaf symlink and changed ownership marker', async () => {
    const project = await ownedProject()
    await project.write(generated())
    const outside = join(project.directory, '..', 'outside.dart')
    await writeFile(outside, 'preserved')
    await rm(join(project.directory, 'lib/main.dart'))
    await symlink(outside, join(project.directory, 'lib/main.dart'))
    await expect(project.write(generated('changed'))).rejects.toThrow('symlink')
    expect(await readFile(outside, 'utf8')).toBe('preserved')
    await writeFile(join(project.directory, '.openpencil-owner.json'), '{}')
    await expect(project.log('changed', 'log')).rejects.toThrow('original ownership marker')
  })

  test('SDK device selection excludes physical, browser, desktop and malformed option IDs', () => {
    const list = JSON.stringify([
      { id: 'booted-ios', name: 'Phone', emulator: true, targetPlatform: 'ios' },
      { id: 'physical', name: 'Physical', emulator: false, targetPlatform: 'ios' },
      { id: 'chrome', name: 'Chrome', emulator: true, targetPlatform: 'web-javascript' },
      { id: 'desktop', name: 'Desktop', emulator: true, targetPlatform: 'darwin' },
      { id: 'emulator-5554', name: 'Android', emulator: true, targetPlatform: 'android-arm64' }
    ])
    expect(parseFlutterDevices(list).map((device) => device.id)).toEqual([
      'booted-ios',
      'emulator-5554'
    ])
    expect(() =>
      parseFlutterDevices(
        JSON.stringify([{ id: '--target', name: 'Bad', emulator: true, targetPlatform: 'ios' }])
      )
    ).toThrow('validation')
    expect(() => runFlutterArguments({ id: '--target', name: 'Bad', platform: 'ios' })).toThrow(
      'invalid device'
    )
    expect(createFlutterArguments('ios')).toContain('--no-pub')
  })

  test('child environment excludes secrets and prevents SDK mirror fallback', () => {
    const environment = flutterEnvironment({
      PATH: '/cached/bin',
      HOME: '/owned/home',
      TOKEN: 'secret',
      FLUTTER_STORAGE_BASE_URL: 'https://untrusted.invalid'
    })
    expect(environment.TOKEN).toBeUndefined()
    expect(environment.FLUTTER_STORAGE_BASE_URL).toBe('http://127.0.0.1:0')
    expect(environment.FLUTTER_SUPPRESS_ANALYTICS).toBe('true')
  })

  test('native plugin dependencies fail before activation, SDK-only projects remain valid', () => {
    expect(() => validateOfflineDependencies(generated())).not.toThrow()
    const files = generated()
    files.set(
      'pubspec.yaml',
      'dependencies:\n  flutter:\n    sdk: flutter\n  webview_flutter: 4.13.1\n'
    )
    expect(() => validateOfflineDependencies(files)).toThrow(
      'Flutter SDK runtime dependencies only'
    )
  })

  test('Android exact missing Gradle cache fails before wrapper mutation', async () => {
    const project = new FakeProject()
    project.platform.set(
      'android/gradle/wrapper/gradle-wrapper.properties',
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14-all.zip\n'
    )
    await expect(
      prepareOfflineAndroid(project, testSDK, async () => {
        throw new Error('Missing cache')
      })
    ).rejects.toThrow('must already be installed')
    expect(project.platform.has('android/gradlew')).toBe(false)
  })

  test('Android wrapper uses offline Gradle and does not rewrite global cache configuration', async () => {
    const project = new FakeProject()
    const properties =
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14-all.zip\n'
    project.platform.set('android/gradle/wrapper/gradle-wrapper.properties', properties)
    project.platform.set('android/gradlew', '#!/bin/sh\nGradleWrapperMain\n')
    project.platform.set('android/gradle.properties', 'org.gradle.jvmargs=-Xmx1G\n')
    const paths: string[] = []
    await prepareOfflineAndroid(
      project,
      { ...testSDK, environment: { GRADLE_USER_HOME: '/cached/gradle' } },
      async (path) => {
        paths.push(path)
      }
    )
    expect(paths).toEqual([gradleCachedDistribution(properties, '/cached/gradle')])
    expect(project.platform.get('android/gradlew')).toBe(OFFLINE_GRADLE_WRAPPER)
    expect(project.platform.get('android/gradlew-openpencil-original')).toBe(
      '#!/bin/sh\nGradleWrapperMain\n'
    )
    expect(project.platform.get('android/gradle.properties')).toContain(
      'android.builder.sdkDownload=false'
    )
    expect(() =>
      gradleCachedDistribution('distributionUrl=https://untrusted.invalid/gradle.zip\n', '/cache')
    ).toThrow('unsupported distribution')
  })
})
