import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..')
const SECRET_WORKFLOW = readFileSync(
  resolve(REPOSITORY_ROOT, '.github/workflows/secrets.yml'),
  'utf8'
)
const MAIN_CI_WORKFLOW = readFileSync(resolve(REPOSITORY_ROOT, '.github/workflows/ci.yml'), 'utf8')
const SCAN_COMMAND =
  'run: bun --config=/dev/null --no-env-file --no-install tools/secret-scan/src/index.ts'

test('runs the secret gate for upstream and lowcode mainline pull requests and pushes', () => {
  expect(SECRET_WORKFLOW).toContain('pull_request:\n    branches: [master, lowcode-rebaseline]')
  expect(SECRET_WORKFLOW).toContain('push:\n    branches: [master, lowcode-rebaseline]')
  expect(SECRET_WORKFLOW).not.toContain('paths-ignore:')
  expect(SECRET_WORKFLOW.split(SCAN_COMMAND)).toHaveLength(2)
  expect(SECRET_WORKFLOW).not.toContain('run: bun tools/secret-scan/src/index.ts')
  expect(MAIN_CI_WORKFLOW).not.toContain('run: bun run check:secrets')
})

test('keeps the independent secret workflow read-only and immutable before scanning', () => {
  const gateOffset = SECRET_WORKFLOW.indexOf(SCAN_COMMAND)
  expect(gateOffset).toBeGreaterThan(0)
  const beforeGate = SECRET_WORKFLOW.slice(0, gateOffset)
  const preScanCommands = [...beforeGate.matchAll(/^\s+run:\s*(.+)$/gm)].map(
    ([, command]) => command
  )

  expect(SECRET_WORKFLOW).toContain('permissions:\n  contents: read')
  expect(SECRET_WORKFLOW).not.toMatch(/^\s*[a-z-]+:\s*write\s*$/m)
  expect(SECRET_WORKFLOW).not.toContain('${{ secrets.')
  expect(SECRET_WORKFLOW).toContain('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6')
  expect(SECRET_WORKFLOW).toContain('bun-version: 1.3.10')
  expect(SECRET_WORKFLOW).toContain('no-cache: true')
  expect(SECRET_WORKFLOW).toContain('run: test "$(bun --version)" = "1.3.10"')
  expect(preScanCommands).toEqual(['test "$(bun --version)" = "1.3.10"'])
  expect(SCAN_COMMAND).toContain('--config=/dev/null')
  expect(SCAN_COMMAND).toContain('--no-env-file')
  expect(SCAN_COMMAND).toContain('--no-install')
  expect(beforeGate).not.toContain('uses: ./')
  expect(beforeGate).not.toMatch(/\b(?:bun|npm|pnpm|yarn)\s+(?:ci|install)\b/)
  for (const action of SECRET_WORKFLOW.matchAll(/^\s*- uses: (.+)$/gm)) {
    expect(action[1]).toMatch(/^[^@\s]+@[0-9a-f]{40}$/)
  }
  expect(SECRET_WORKFLOW).toContain('persist-credentials: false')
  expect(SECRET_WORKFLOW).toContain('timeout-minutes: 10')
})
