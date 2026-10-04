import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { FlutterPreviewError } from './errors'
import type { FlutterProject } from './owned-project'
import type { FlutterSDK } from './sdk'

export const OFFLINE_GRADLE_WRAPPER =
  '#!/usr/bin/env sh\nexec "$(dirname "$0")/gradlew-openpencil-original" --offline --no-daemon -Dorg.gradle.java.installations.auto-download=false -Pandroid.builder.sdkDownload=false "$@"\n'

export function gradleCachedDistribution(properties: string, cacheDirectory: string): string {
  const line = properties.split(/\r?\n/).filter((entry) => entry.startsWith('distributionUrl='))
  if (line.length !== 1)
    throw new FlutterPreviewError(
      'flutter-preview-gradle-invalid',
      'Generated Gradle wrapper has no unique distribution URL.'
    )
  const url = line[0]?.slice('distributionUrl='.length).replace(/\\:/g, ':') ?? ''
  const match =
    /^https:\/\/services\.gradle\.org\/distributions\/(gradle-\d+\.\d+(?:\.\d+)?-(?:all|bin))\.zip$/.exec(
      url
    )
  const distribution = match?.[1]
  if (!distribution)
    throw new FlutterPreviewError(
      'flutter-preview-gradle-invalid',
      'Generated Gradle wrapper uses an unsupported distribution source.'
    )
  // Gradle Wrapper PathAssembler uses the distribution URL's MD5 as an unsigned base-36 cache key.
  const hash = BigInt(`0x${createHash('md5').update(url).digest('hex')}`).toString(36)
  return join(
    cacheDirectory,
    'wrapper/dists',
    distribution,
    hash,
    distribution.replace(/-(?:all|bin)$/, ''),
    'bin/gradle'
  )
}

export async function prepareOfflineAndroid(
  project: FlutterProject,
  sdk: FlutterSDK,
  checkCachedExecutable: (path: string) => Promise<void> = async (path) => {
    await access(path, constants.X_OK)
    if (!(await stat(path)).isFile()) throw new Error('Cached Gradle executable is unavailable')
  }
): Promise<void> {
  if (process.platform === 'win32')
    throw new FlutterPreviewError(
      'flutter-preview-android-host-unsupported',
      'This offline Android launcher currently requires a Unix host.'
    )
  const properties = await project.readPlatform('android/gradle/wrapper/gradle-wrapper.properties')
  const cached = gradleCachedDistribution(
    properties,
    sdk.environment.GRADLE_USER_HOME ?? join(homedir(), '.gradle')
  )
  try {
    await checkCachedExecutable(cached)
  } catch {
    throw new FlutterPreviewError(
      'flutter-preview-gradle-cache-unavailable',
      'The exact Gradle distribution must already be installed in the local wrapper cache. This preview will not download it.'
    )
  }
  const original = await project.readPlatform('android/gradlew')
  if (!original.startsWith('#!') || !original.includes('GradleWrapperMain')) {
    throw new FlutterPreviewError(
      'flutter-preview-gradle-invalid',
      'The generated SDK Gradle wrapper was not recognized.'
    )
  }
  const gradleProperties = await project.readPlatform('android/gradle.properties')
  await project.writePlatform('android/gradlew-openpencil-original', original, true)
  await project.writePlatform('android/gradlew', OFFLINE_GRADLE_WRAPPER, true)
  await project.writePlatform(
    'android/gradle.properties',
    `${gradleProperties}\norg.gradle.java.installations.auto-download=false\nandroid.builder.sdkDownload=false\n`
  )
}
