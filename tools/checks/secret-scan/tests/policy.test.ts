import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

import {
  isIgnoredUntrackedFinding,
  parseGitleaksFindingPaths,
  repositoryRelativeFindingPath,
  type FindingPathProbe
} from '../src/policy'

const REPOSITORY_ROOT = resolve('/workspace/open-pencil')

function probe(overrides: Partial<FindingPathProbe> = {}): FindingPathProbe {
  return {
    exists: () => true,
    isIgnored: () => true,
    isTracked: () => false,
    ...overrides
  }
}

test('parses only a non-empty bounded gitleaks finding array', () => {
  expect(parseGitleaksFindingPaths('[{"File":"desktop/.oauth.local"}]')).toEqual([
    'desktop/.oauth.local'
  ])
  expect(parseGitleaksFindingPaths('[]')).toBeNull()
  expect(parseGitleaksFindingPaths('{"File":"secret.txt"}')).toBeNull()
  expect(parseGitleaksFindingPaths('[{"File":1}]')).toBeNull()
  expect(parseGitleaksFindingPaths('not-json')).toBeNull()
})

test('normalizes only findings contained by the repository root', () => {
  expect(repositoryRelativeFindingPath(REPOSITORY_ROOT, 'desktop/.oauth.local')).toBe(
    'desktop/.oauth.local'
  )
  expect(repositoryRelativeFindingPath(REPOSITORY_ROOT, '../outside.txt')).toBeNull()
  expect(repositoryRelativeFindingPath(REPOSITORY_ROOT, REPOSITORY_ROOT)).toBeNull()
})

test('ignores a finding only while it remains present, ignored, and untracked', () => {
  expect(isIgnoredUntrackedFinding(REPOSITORY_ROOT, 'desktop/.oauth.local', probe())).toBeTrue()
  expect(
    isIgnoredUntrackedFinding(
      REPOSITORY_ROOT,
      'desktop/.oauth.local',
      probe({ isTracked: () => true })
    )
  ).toBeFalse()
  expect(
    isIgnoredUntrackedFinding(
      REPOSITORY_ROOT,
      'desktop/.oauth.local',
      probe({ isIgnored: () => false })
    )
  ).toBeFalse()
  expect(
    isIgnoredUntrackedFinding(
      REPOSITORY_ROOT,
      'desktop/.oauth.local',
      probe({ isTracked: () => null })
    )
  ).toBeFalse()
  expect(
    isIgnoredUntrackedFinding(
      REPOSITORY_ROOT,
      'desktop/.oauth.local',
      probe({ exists: () => false })
    )
  ).toBeFalse()
})

test('fails closed when the path becomes tracked during classification', () => {
  let trackedChecks = 0
  const status = probe({
    isTracked: () => {
      trackedChecks += 1
      return trackedChecks > 1
    }
  })

  expect(isIgnoredUntrackedFinding(REPOSITORY_ROOT, 'desktop/.oauth.local', status)).toBeFalse()
  expect(trackedChecks).toBe(2)
})
