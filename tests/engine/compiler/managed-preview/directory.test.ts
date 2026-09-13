import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ManagedPreviewDirectory } from '#compiler/managed-preview/directory'

const SESSION = '12345678-1234-4123-8123-123456789abc'
const roots: string[] = []
const directories: ManagedPreviewDirectory[] = []

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'openpencil-managed-directory-test-'))
  roots.push(base)
  chmodSync(base, 0o700)
  const directory = new ManagedPreviewDirectory(SESSION, base)
  directories.push(directory)
  return { base, directory }
}

afterEach(() => {
  for (const directory of directories.splice(0)) directory.release()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('managed preview owned directory', () => {
  test('creates only private session directories/files and writes atomically within the session', () => {
    const { base, directory } = fixture()
    directory.bind('personal-notes')
    directory.json('snapshots/current.json', { version: 1, count: 3 })
    expect(lstatSync(base).mode & 0o077).toBe(0)
    expect(lstatSync(directory.root).mode & 0o077).toBe(0)
    expect(lstatSync(join(directory.root, 'snapshots')).mode & 0o077).toBe(0)
    expect(lstatSync(directory.path('snapshots/current.json')).mode & 0o077).toBe(0)
    expect(directory.read('snapshots/current.json')).toEqual({ version: 1, count: 3 })
    directory.json('snapshots/current.json', { version: 1, count: 4 })
    expect(directory.read('snapshots/current.json')).toEqual({ version: 1, count: 4 })
    expect(directory.read('absent.json')).toBeNull()
  })

  test('binds an existing directory to one application and preserves its owner marker', () => {
    const { directory } = fixture()
    directory.bind('personal-notes')
    const original = readFileSync(directory.path('owner.json'), 'utf8')
    directory.bind('personal-notes')
    expect(() => directory.bind('another-application')).toThrow('ownership could not be verified')
    expect(readFileSync(directory.path('owner.json'), 'utf8')).toBe(original)
  })

  test('excludes a second live companion and permits reacquisition after release', () => {
    const { base, directory } = fixture()
    expect(() => new ManagedPreviewDirectory(SESSION, base)).toThrow('already owned')
    directory.release()
    directory.release()
    const replacement = new ManagedPreviewDirectory(SESSION, base)
    directories.push(replacement)
    expect(existsSync(replacement.path('session.lock'))).toBe(true)
  })

  test('rejects changed lock tokens without removing another owner lock', () => {
    const { directory } = fixture()
    directory.json('session.lock', { version: 1, pid: process.pid, token: 'another-owner' })
    expect(() => directory.release()).toThrow('ownership could not be verified')
    expect(directory.read('session.lock')).toEqual({
      version: 1,
      pid: process.pid,
      token: 'another-owner'
    })
  })

  test.each(['../escaped.json', '../../escaped.json', '/private/tmp/escaped.json', '.', ''])(
    'rejects path escape %j',
    (name) => {
      const { directory } = fixture()
      expect(() => directory.path(name)).toThrow('ownership could not be verified')
    }
  )

  test('rejects invalid session locators before creating them', () => {
    const { base } = fixture()
    for (const session of ['../escape', '/absolute', SESSION.toUpperCase(), '']) {
      expect(() => new ManagedPreviewDirectory(session, base)).toThrow(
        'Invalid managed preview protocol data.'
      )
    }
  })

  test('rejects an existing session or base directory with public permissions', () => {
    const { base, directory } = fixture()
    directory.release()
    chmodSync(directory.root, 0o755)
    expect(() => new ManagedPreviewDirectory(SESSION, base)).toThrow(
      'ownership could not be verified'
    )
    chmodSync(directory.root, 0o700)
    chmodSync(base, 0o755)
    expect(() => new ManagedPreviewDirectory(SESSION, base)).toThrow(
      'ownership could not be verified'
    )
    chmodSync(base, 0o700)
  })

  test('withholds bad JSON contents and refuses oversized state files', () => {
    const { directory } = fixture()
    directory.write('bad.json', 'PRIVATE-CONTENT: invalid JSON')
    expect(() => directory.read('bad.json')).toThrow('Private file contents were not printed.')
    try {
      directory.read('bad.json')
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE-CONTENT')
    }
    directory.write('large.json', ' '.repeat(2 * 1024 * 1024 + 1))
    expect(() => directory.read('large.json')).toThrow('ownership could not be verified')
  })

  test('rejects symlink files and parent directories without reading or writing their targets', () => {
    const { base, directory } = fixture()
    const outside = join(base, 'outside')
    mkdirSync(outside, { mode: 0o700 })
    writeFileSync(join(outside, 'state.json'), '{"private":true}', { mode: 0o600 })
    symlinkSync(join(outside, 'state.json'), join(directory.root, 'linked.json'))
    symlinkSync(outside, join(directory.root, 'linked-directory'))
    expect(() => directory.read('linked.json')).toThrow('ownership could not be verified')
    expect(() => directory.write('linked.json', 'changed')).toThrow(
      'ownership could not be verified'
    )
    expect(() => directory.read('linked-directory/state.json')).toThrow(
      'ownership could not be verified'
    )
    expect(readFileSync(join(outside, 'state.json'), 'utf8')).toBe('{"private":true}')
  })

  test('rejects dangling symlink state paths instead of accepting them as missing state', () => {
    const { base, directory } = fixture()
    symlinkSync(join(base, 'missing-target'), join(directory.root, 'dangling.json'))
    expect(() => directory.read('dangling.json')).toThrow('ownership could not be verified')
  })

  test('rechecks the session root before using paths after a directory replacement', () => {
    const { base, directory } = fixture()
    const moved = join(base, 'original-session')
    const outside = join(base, 'replacement-target')
    mkdirSync(outside, { mode: 0o700 })
    const protectedFile = join(outside, 'state.json')
    writeFileSync(protectedFile, '{"unchanged":true}', { mode: 0o600 })
    renameSync(directory.root, moved)
    symlinkSync(outside, directory.root)
    try {
      expect(() => directory.read('state.json')).toThrow('ownership could not be verified')
      expect(() => directory.write('state.json', 'changed')).toThrow(
        'ownership could not be verified'
      )
      expect(readFileSync(protectedFile, 'utf8')).toBe('{"unchanged":true}')
    } finally {
      unlinkSync(directory.root)
      renameSync(moved, directory.root)
    }
  })
})
