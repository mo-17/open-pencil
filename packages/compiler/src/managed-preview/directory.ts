import { randomBytes } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { parseManagedPreviewSessionId } from './parse'

const IDENTIFIER = 'net.dannote.open-pencil'
function failure(): never {
  throw new Error('Managed preview private directory or ownership could not be verified.')
}
function present(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
function regular(path: string, directory: boolean): void {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) failure()
  if (process.getuid && info.uid !== process.getuid()) failure()
}
export function managedPreviewRoot(): string {
  const home = realpathSync(homedir())
  if (process.platform === 'darwin')
    return join(home, 'Library', 'Application Support', IDENTIFIER, 'managed-preview-v1')
  if (process.platform === 'linux')
    return join(home, '.local', 'share', IDENTIFIER, 'managed-preview-v1')
  throw new Error('Managed preview currently requires macOS or Linux desktop.')
}
export function privateDirectory(path: string): void {
  if (!present(path)) {
    privateDirectory(dirname(path))
    mkdirSync(path, { mode: 0o700 })
  }
  regular(path, true)
}
export function readPrivateJSON(path: string): unknown {
  regular(path, false)
  if (lstatSync(path).size > 2 * 1024 * 1024) failure()
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(
      'Managed preview state could not be parsed. Private file contents were not printed.'
    )
  }
}
export class ManagedPreviewDirectory {
  readonly root: string
  private readonly identity: { dev: number; ino: number }
  private readonly token = randomBytes(24).toString('hex')
  private released = false
  constructor(
    readonly sessionId: string,
    base = managedPreviewRoot()
  ) {
    parseManagedPreviewSessionId(sessionId)
    privateDirectory(base)
    if ((lstatSync(base).mode & 0o077) !== 0) failure()
    this.root = join(realpathSync(base), sessionId)
    privateDirectory(this.root)
    const info = lstatSync(this.root)
    if ((info.mode & 0o077) !== 0) failure()
    this.identity = { dev: info.dev, ino: info.ino }
    this.lock()
  }
  path(name: string): string {
    regular(this.root, true)
    const info = lstatSync(this.root)
    if (info.dev !== this.identity.dev || info.ino !== this.identity.ino) failure()
    const path = resolve(this.root, name)
    const rel = relative(this.root, path)
    if (!rel || rel.startsWith('..' + sep) || rel === '..' || rel.startsWith(sep)) failure()
    let parent = dirname(path)
    while (parent !== this.root) {
      if (present(parent)) regular(parent, true)
      parent = dirname(parent)
    }
    if (present(path)) regular(path, false)
    return path
  }
  write(name: string, content: string): void {
    const path = this.path(name)
    privateDirectory(dirname(path))
    const temporary = path + '.' + randomBytes(8).toString('hex') + '.tmp'
    try {
      writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, path)
    } finally {
      if (present(temporary)) unlinkSync(temporary)
    }
  }
  json(name: string, value: unknown): void {
    this.write(name, JSON.stringify(value) + '\n')
  }
  read(name: string): unknown {
    const path = this.path(name)
    return present(path) ? readPrivateJSON(path) : null
  }
  bind(applicationId: string): void {
    const expected = { version: 1, sessionId: this.sessionId, applicationId }
    const marker = this.read('owner.json')
    if (marker !== null && JSON.stringify(marker) !== JSON.stringify(expected)) failure()
    if (marker === null) this.json('owner.json', expected)
  }
  private lock(): void {
    const path = this.path('session.lock')
    if (present(path)) {
      const saved = readPrivateJSON(path)
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('pid' in saved) ||
        typeof saved.pid !== 'number' ||
        !Number.isSafeInteger(saved.pid) ||
        saved.pid < 1
      )
        failure()
      let alive = true
      try {
        process.kill(saved.pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false
      }
      if (alive)
        throw new Error(
          'This managed preview session is already owned by another running companion.'
        )
      unlinkSync(path)
    }
    const descriptor = openSync(path, 'wx', 0o600)
    try {
      writeFileSync(
        descriptor,
        JSON.stringify({ version: 1, pid: process.pid, token: this.token }) + '\n'
      )
    } finally {
      closeSync(descriptor)
    }
  }
  release(): void {
    if (this.released) return
    this.released = true
    const path = this.path('session.lock')
    const saved = readPrivateJSON(path)
    if (!saved || typeof saved !== 'object' || !('token' in saved) || saved.token !== this.token)
      failure()
    unlinkSync(path)
  }
}
