import { expect, test } from 'bun:test'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  captureWorkingTreeAuthority,
  createWorkingTreeSnapshot,
  materializeIndexBlobSnapshot,
  parseCommitEligiblePaths,
  parseGitBatchBlobs,
  parseGitBatchCheck,
  parseIndexEntries,
  workingTreeAuthorityEquals
} from '../src/snapshot'

test('parses only bounded NUL-terminated repository paths', () => {
  const root = resolve('/workspace/open-pencil')

  expect(parseCommitEligiblePaths(root, Buffer.from('src/a.ts\0docs/b.md\0'))).toEqual([
    'src/a.ts',
    'docs/b.md'
  ])
  expect(parseCommitEligiblePaths(root, Buffer.from(''))).toEqual([])
  expect(parseCommitEligiblePaths(root, Buffer.from('src/a.ts'))).toBeNull()
  expect(parseCommitEligiblePaths(root, Buffer.from('../outside\0'))).toBeNull()
  expect(parseCommitEligiblePaths(root, Buffer.from('src/a.ts\0src/a.ts\0'))).toBeNull()
  expect(parseCommitEligiblePaths(root, Uint8Array.from([0xff, 0]))).toBeNull()
})

test('parses only stage-zero index entries and exact batch blob framing', () => {
  const root = resolve('/workspace/open-pencil')
  const objectID = 'a'.repeat(40)
  const entries = parseIndexEntries(
    root,
    Buffer.from('120000 ' + objectID + ' 0\tcredential-link\0')
  )
  expect(entries).toEqual([{ mode: '120000', objectID, path: 'credential-link' }])
  expect(
    parseIndexEntries(root, Buffer.from('100644 ' + objectID + ' 2\tconflicted.txt\0'))
  ).toBeNull()

  const sizes = parseGitBatchCheck([objectID], Buffer.from(objectID + ' blob 3\n'))
  expect(sizes).toEqual(new Map([[objectID, 3]]))
  const blobs = parseGitBatchBlobs(
    [objectID],
    sizes ?? new Map(),
    Buffer.concat([Buffer.from(objectID + ' blob 3\n'), Buffer.from('abc\n')])
  )
  expect(Buffer.from(blobs?.get(objectID) ?? [])).toEqual(Buffer.from('abc'))
})

test('materializes index symlink blob authority as a scannable regular file', () => {
  const root = mkdtempSync(join(tmpdir(), 'open-pencil-index-snapshot-'))
  try {
    const objectID = 'b'.repeat(40)
    const target = Buffer.from('synthetic-link-authority')
    expect(
      materializeIndexBlobSnapshot(
        root,
        [{ mode: '120000', objectID, path: 'credential-link' }],
        new Map([[objectID, target]])
      )
    ).toBeTrue()

    const link = join(root, 'credential-link')
    expect(lstatSync(link).isFile()).toBeTrue()
    expect(readFileSync(link, 'utf8')).toBe('synthetic-link-authority')
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('bounds materialized bytes across repeated index blob paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'open-pencil-index-snapshot-bound-'))
  try {
    const objectID = 'c'.repeat(40)
    const blob = Buffer.from('ab')
    expect(
      materializeIndexBlobSnapshot(
        root,
        [
          { mode: '100644', objectID, path: 'first.txt' },
          { mode: '100644', objectID, path: 'second.txt' }
        ],
        new Map([[objectID, blob]]),
        3
      )
    ).toBeFalse()
    expect(readdirSync(root)).toEqual([])
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('treats missing worktree paths and gitlink directories as index-owned', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'open-pencil-working-source-'))
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'open-pencil-working-snapshot-'))
  try {
    mkdirSync(join(repositoryRoot, 'nested-repository'))
    const authority = createWorkingTreeSnapshot(repositoryRoot, snapshotRoot, [
      'deleted-tracked-file.txt',
      'nested-repository'
    ])
    expect(authority?.map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: 'missing', path: 'deleted-tracked-file.txt' },
      { kind: 'directory', path: 'nested-repository' }
    ])
    expect(readdirSync(snapshotRoot)).toEqual(['nested-repository'])
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true })
    rmSync(snapshotRoot, { force: true, recursive: true })
  }
})

test('content digests detect same-path same-size worktree replacement', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'open-pencil-working-authority-'))
  try {
    const path = join(repositoryRoot, 'credential.txt')
    writeFileSync(path, 'secret-a')
    const before = captureWorkingTreeAuthority(repositoryRoot, ['credential.txt'])
    writeFileSync(path, 'secret-b')
    const after = captureWorkingTreeAuthority(repositoryRoot, ['credential.txt'])

    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    expect(workingTreeAuthorityEquals(before ?? [], after ?? [])).toBeFalse()
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true })
  }
})
