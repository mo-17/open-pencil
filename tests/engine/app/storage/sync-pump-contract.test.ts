import { describe, expect, test } from 'bun:test'

import { repoPath } from '#tests/helpers/paths'

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  const bodyStart = startIndex + start.length
  const endIndex = source.indexOf(end, bodyStart)
  expect(endIndex).toBeGreaterThan(bodyStart)
  return source.slice(bodyStart, endIndex)
}

describe('storage sync pump source contract', () => {
  test('runs one provider mutation before removing the selected outbox job', async () => {
    const source = await Bun.file(repoPath('src/app/storage/sync/engine.ts')).text()
    const pumpBody = between(
      source,
      'async function pumpOnce(): Promise<void> {',
      '\n}\n\nfunction scheduleWake'
    )
    const successfulAttempt = between(pumpBody, '\n  try {', '\n  } catch (error) {')
    const runCalls = pumpBody.match(/await\s+runJob\(\s*job\s*\)/g) ?? []
    const removeCalls = successfulAttempt.match(/await\s+outbox\.remove\(\s*job\.id\s*\)/g) ?? []

    expect(runCalls).toHaveLength(1)
    expect(removeCalls).toHaveLength(1)
    expect(successfulAttempt.indexOf(runCalls[0] ?? '')).toBeLessThan(
      successfulAttempt.indexOf(removeCalls[0] ?? '')
    )
  })
})
