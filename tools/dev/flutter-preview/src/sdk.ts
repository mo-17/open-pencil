import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { compact } from 'es-toolkit/array'
import * as v from 'valibot'

import type { FlutterPreviewDevice } from '@open-pencil/compiler/flutter-preview'

import { FlutterPreviewError } from './errors'

export interface FlutterSDK {
  executable: string
  directory: string
  environment: NodeJS.ProcessEnv
}

export const FLUTTER_ARGUMENT_PREFIX = ['--no-version-check', '--suppress-analytics'] as const
export const FLUTTER_PROJECT_NAME = 'openpencil_flutter_preview'

export function flutterEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'LANG',
    'LC_ALL',
    'SystemRoot',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'ANDROID_HOME',
    'ANDROID_SDK_ROOT',
    'JAVA_HOME',
    'PUB_CACHE',
    'GRADLE_USER_HOME'
  ]) {
    if (environment[key] !== undefined) result[key] = environment[key]
  }
  result.FLUTTER_SUPPRESS_ANALYTICS = 'true'
  result.COCOAPODS_DISABLE_STATS = 'true'
  result.CI = 'true'
  // Cache misses must fail instead of silently downloading engine artifacts from a mirror.
  result.FLUTTER_STORAGE_BASE_URL = 'http://127.0.0.1:0'
  return result
}

export async function resolveFlutterSDK(
  environment: NodeJS.ProcessEnv = process.env
): Promise<FlutterSDK> {
  if (process.platform === 'win32')
    throw new FlutterPreviewError(
      'flutter-preview-host-unsupported',
      'This owned process-group native preview currently requires a Unix host.'
    )
  const candidates = compact((environment.PATH ?? '').split(delimiter)).map((path) =>
    join(path, 'flutter')
  )
  candidates.push(join(homedir(), 'fvm/default/bin/flutter'))
  for (const candidate of new Set(candidates)) {
    try {
      const executable = await realpath(candidate)
      await access(executable, constants.X_OK)
      const directory = dirname(dirname(executable))
      if (!(await stat(join(directory, 'packages/flutter_tools'))).isDirectory()) continue
      await access(join(directory, 'bin/cache/flutter_tools.snapshot'), constants.R_OK)
      await access(join(directory, 'bin/cache/dart-sdk/bin/dart'), constants.X_OK)
      return { executable, directory, environment: flutterEnvironment(environment) }
    } catch {
      continue
    }
  }
  throw new FlutterPreviewError(
    'flutter-preview-sdk-unavailable',
    'An existing Flutter SDK with cached tools is required. Configure PATH or the local fvm/default SDK; this preview does not install or upgrade Flutter.'
  )
}

export async function ensureFlutterEngineCache(
  sdk: FlutterSDK,
  platform: FlutterPreviewDevice['platform']
): Promise<void> {
  const engine = join(sdk.directory, 'bin/cache/artifacts/engine')
  const required = [
    'common/flutter_patched_sdk',
    ...(platform === 'ios'
      ? ['ios', 'ios-profile', 'ios-release', 'darwin-x64']
      : [
          'android-arm',
          'android-arm64',
          'android-x64',
          'android-arm-profile',
          'android-arm64-profile',
          'android-x64-profile',
          'android-arm-release',
          'android-arm64-release',
          'android-x64-release'
        ])
  ]
  try {
    for (const path of required)
      if (!(await stat(join(engine, path))).isDirectory()) throw new Error('Missing engine cache')
  } catch {
    throw new FlutterPreviewError(
      'flutter-preview-cache-unavailable',
      'The selected platform engine artifacts must already be cached in the local Flutter SDK. This preview does not download SDK artifacts.'
    )
  }
}

const rawDevice = v.looseObject({
  id: v.pipe(v.string(), v.regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
  emulator: v.boolean(),
  isSupported: v.optional(v.boolean()),
  targetPlatform: v.optional(v.string()),
  platformType: v.optional(v.string())
})

export function parseFlutterDevices(stdout: string): FlutterPreviewDevice[] {
  let input: unknown
  try {
    input = JSON.parse(stdout)
  } catch {
    throw new FlutterPreviewError(
      'flutter-preview-devices-invalid',
      'The local Flutter SDK returned an invalid device list.'
    )
  }
  const parsed = v.safeParse(v.pipe(v.array(rawDevice), v.maxLength(128)), input)
  if (!parsed.success)
    throw new FlutterPreviewError(
      'flutter-preview-devices-invalid',
      'The local Flutter SDK device list failed validation.'
    )
  const devices: FlutterPreviewDevice[] = []
  const seen = new Set<string>()
  for (const device of parsed.output) {
    const target = device.targetPlatform ?? device.platformType ?? ''
    let platform: FlutterPreviewDevice['platform'] | null = null
    if (target === 'ios') platform = 'ios'
    else if (/^android(?:-(?:arm|arm64|x64|x86))?$/.test(target)) platform = 'android'
    if (!device.emulator || device.isSupported === false || !platform || seen.has(device.id))
      continue
    seen.add(device.id)
    devices.push({ id: device.id, name: device.name, platform })
  }
  return devices.slice(0, 64)
}

export function createFlutterArguments(
  platform: FlutterPreviewDevice['platform']
): readonly string[] {
  return [
    ...FLUTTER_ARGUMENT_PREFIX,
    'create',
    '--empty',
    `--platforms=${platform}`,
    '--no-pub',
    '--project-name',
    FLUTTER_PROJECT_NAME,
    '--org',
    'dev.openpencil.preview',
    '.'
  ]
}

export function runFlutterArguments(device: FlutterPreviewDevice): readonly string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(device.id)) {
    throw new FlutterPreviewError(
      'flutter-preview-device-invalid',
      'Flutter preview rejected an invalid device identifier.'
    )
  }
  return [
    ...FLUTTER_ARGUMENT_PREFIX,
    'run',
    '--machine',
    '--debug',
    '--no-pub',
    '-d',
    device.id,
    '--target',
    'lib/main.dart'
  ]
}
