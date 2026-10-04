import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { FlutterPreviewError } from './errors'

export type GeneratedFiles = ReadonlyMap<string, string | Uint8Array>
export interface FlutterProject {
  readonly sessionId: string
  readonly directory: string
  write(files: GeneratedFiles, expected?: GeneratedFiles): Promise<void>
  log(name: string, content: string): Promise<void>
  readPlatform(path: string): Promise<string>
  writePlatform(path: string, content: string, executable?: boolean): Promise<void>
}

type ProjectFileSystem = Pick<typeof fs, 'lstat' | 'realpath' | 'mkdir' | 'open'>
const MARKER = '.openpencil-owner.json'
const MAX_GENERATED_BYTES = 16 * 1024 * 1024
const PLATFORM_PATHS = new Set([
  'android/gradlew',
  'android/gradlew-openpencil-original',
  'android/gradle/wrapper/gradle-wrapper.properties',
  'android/gradle.properties'
])

export function validateGeneratedFiles(files: GeneratedFiles): void {
  if (
    files.size === 0 ||
    files.size > 512 ||
    !files.has('pubspec.yaml') ||
    !files.has('lib/main.dart')
  ) {
    throw new FlutterPreviewError(
      'flutter-preview-files-invalid',
      'The Flutter compiler did not return a bounded project.'
    )
  }
  let bytes = 0
  for (const [path, content] of files) {
    safeRelativePath(path)
    if (
      !/^(?:lib\/|assets\/|test\/|pubspec\.yaml$|analysis_options\.yaml$|README\.md$|\.gitignore$)/.test(
        path
      )
    ) {
      throw new FlutterPreviewError(
        'flutter-preview-files-invalid',
        'The compiler output included an unsupported native project path.'
      )
    }
    const length = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
    bytes += length
    if (length > 4 * 1024 * 1024 || bytes > MAX_GENERATED_BYTES) {
      throw new FlutterPreviewError(
        'flutter-preview-files-limit',
        'The generated Flutter project exceeded its byte budget.'
      )
    }
  }
}

export function safeRelativePath(path: string): void {
  if (
    path.length > 512 ||
    !/^[\w./-]+$/.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new FlutterPreviewError(
      'flutter-preview-path-invalid',
      'Flutter preview rejected an unsafe generated file path.'
    )
  }
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export class OwnedFlutterProject implements FlutterProject {
  private constructor(
    readonly sessionId: string,
    readonly directory: string,
    private readonly ownerToken: string,
    private readonly fileSystem: ProjectFileSystem
  ) {}

  static async create(
    options: { temporaryDirectory?: string; fileSystem?: ProjectFileSystem } = {}
  ): Promise<OwnedFlutterProject> {
    const fileSystem = options.fileSystem ?? fs
    const temporaryDirectory = await fileSystem.realpath(options.temporaryDirectory ?? tmpdir())
    const base = join(temporaryDirectory, 'openpencil-flutter-preview')
    try {
      await fileSystem.mkdir(base, { mode: 0o700 })
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
    }
    const baseStat = await fileSystem.lstat(base)
    if (
      !baseStat.isDirectory() ||
      baseStat.isSymbolicLink() ||
      (process.getuid && baseStat.uid !== process.getuid()) ||
      (baseStat.mode & 0o077) !== 0
    ) {
      throw new FlutterPreviewError(
        'flutter-preview-directory-invalid',
        'Flutter preview requires a private host-owned temporary base directory.'
      )
    }
    const sessionId = randomUUID()
    const directory = join(base, sessionId)
    await fileSystem.mkdir(directory, { mode: 0o700 })
    const ownerToken = randomUUID()
    const marker = await fileSystem.open(join(directory, MARKER), 'wx', 0o600)
    try {
      await marker.writeFile(JSON.stringify({ version: 1, sessionId, ownerToken }))
    } finally {
      await marker.close()
    }
    return new OwnedFlutterProject(sessionId, directory, ownerToken, fileSystem)
  }

  private async assertOwnership(): Promise<void> {
    const stat = await this.fileSystem.lstat(this.directory)
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await this.fileSystem.realpath(this.directory)) !== this.directory
    ) {
      throw new FlutterPreviewError(
        'flutter-preview-directory-invalid',
        'Flutter preview session directory ownership changed.'
      )
    }
    const path = join(this.directory, MARKER)
    const markerStat = await this.fileSystem.lstat(path)
    if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 1_024) {
      throw new FlutterPreviewError(
        'flutter-preview-directory-invalid',
        'Flutter preview session marker is unavailable.'
      )
    }
    const marker = await this.fileSystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    let content: string
    try {
      content = await marker.readFile('utf8')
    } finally {
      await marker.close()
    }
    if (
      content !==
      JSON.stringify({ version: 1, sessionId: this.sessionId, ownerToken: this.ownerToken })
    ) {
      throw new FlutterPreviewError(
        'flutter-preview-directory-invalid',
        'Flutter preview refused a session without its original ownership marker.'
      )
    }
  }

  private async path(relative: string): Promise<string> {
    safeRelativePath(relative)
    await this.assertOwnership()
    const destination = resolve(this.directory, relative)
    if (!destination.startsWith(`${this.directory}${sep}`)) {
      throw new FlutterPreviewError(
        'flutter-preview-path-invalid',
        'Flutter preview file escaped its owned session directory.'
      )
    }
    let parent = this.directory
    for (const part of relative.split('/').slice(0, -1)) {
      parent = join(parent, part)
      try {
        await this.fileSystem.mkdir(parent, { mode: 0o700 })
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
      }
      const stat = await this.fileSystem.lstat(parent)
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (await this.fileSystem.realpath(parent)) !== parent
      ) {
        throw new FlutterPreviewError(
          'flutter-preview-path-invalid',
          'Flutter preview rejected a symlink or non-directory in its file path.'
        )
      }
    }
    try {
      const stat = await this.fileSystem.lstat(destination)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new FlutterPreviewError(
          'flutter-preview-path-invalid',
          'Flutter preview rejected a symlink or non-file output.'
        )
      }
    } catch (error) {
      if (!missing(error)) throw error
    }
    return destination
  }

  async write(files: GeneratedFiles, expected?: GeneratedFiles): Promise<void> {
    validateGeneratedFiles(files)
    // Validate every destination and the previous generated contents before any mutation.
    const paths = new Map<string, string>()
    for (const path of files.keys()) paths.set(path, await this.path(path))
    for (const [path, content] of expected ?? []) {
      const destination = await this.path(path)
      const previous = await this.fileSystem.open(
        destination,
        constants.O_RDONLY | constants.O_NOFOLLOW
      )
      let bytes: Buffer
      try {
        const stat = await previous.stat()
        if (stat.size > 4 * 1024 * 1024)
          throw new FlutterPreviewError(
            'flutter-preview-files-changed',
            'Owned generated output changed outside this session.'
          )
        bytes = await previous.readFile()
      } finally {
        await previous.close()
      }
      const wanted = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content)
      if (!bytes.equals(wanted)) {
        throw new FlutterPreviewError(
          'flutter-preview-files-changed',
          'Flutter preview preserved generated output that was changed outside the active session.'
        )
      }
    }
    for (const [path, content] of files) {
      const destination = paths.get(path)
      if (!destination)
        throw new FlutterPreviewError(
          'flutter-preview-path-invalid',
          'Flutter preview output path was not validated.'
        )
      const file = await this.fileSystem.open(
        destination,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o600
      )
      try {
        await file.writeFile(content)
      } finally {
        await file.close()
      }
    }
  }

  async log(name: string, content: string): Promise<void> {
    const path = await this.path(`.openpencil/logs/${name}.log`)
    const file = await this.fileSystem.open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600
    )
    try {
      await file.writeFile(Buffer.from(content).subarray(-64_000))
    } finally {
      await file.close()
    }
  }

  async readPlatform(relative: string): Promise<string> {
    if (!PLATFORM_PATHS.has(relative))
      throw new FlutterPreviewError(
        'flutter-preview-path-invalid',
        'Unsupported host platform file.'
      )
    const path = await this.path(relative)
    const file = await this.fileSystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (stat.size > 256 * 1024)
        throw new FlutterPreviewError(
          'flutter-preview-files-limit',
          'Native platform file exceeded its budget.'
        )
      return await file.readFile('utf8')
    } finally {
      await file.close()
    }
  }

  async writePlatform(relative: string, content: string, executable = false): Promise<void> {
    if (!PLATFORM_PATHS.has(relative) || Buffer.byteLength(content) > 256 * 1024) {
      throw new FlutterPreviewError(
        'flutter-preview-path-invalid',
        'Unsupported host platform file.'
      )
    }
    const path = await this.path(relative)
    const file = await this.fileSystem.open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      executable ? 0o700 : 0o600
    )
    try {
      await file.writeFile(content)
      if (executable) await file.chmod(0o700)
    } finally {
      await file.close()
    }
  }
}
