import { expect, test } from 'bun:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageRoot, '../..')
const buildFixture = resolve(packageRoot, 'tests/fixtures/build-framework-neutral-consumer.ts')

interface ConsumerBundleResult {
  contributingInputs: string[]
  bundledSource: string
}

async function buildConsumerBundle(): Promise<ConsumerBundleResult> {
  // bun:test retains the workspace's source-resolution context for nested builds.
  // A fresh Bun process models an external consumer and resolves public dist exports.
  const child = Bun.spawn({
    cmd: [process.execPath, buildFixture],
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])

  if (exitCode !== 0) {
    throw new Error(`Consumer bundle build failed (${exitCode}):\n${stderr}`)
  }

  return JSON.parse(stdout) as ConsumerBundleResult
}

test('tree-shakes Vue and DOM adapters from a framework-neutral consumer bundle', async () => {
  const { contributingInputs, bundledSource } = await buildConsumerBundle()

  expect(contributingInputs).toContain('packages/motion-runtime/dist/runtime.js')
  expect(
    contributingInputs.filter((path) => /(?:^|\/)packages\/motion\/dist\//.test(path))
  ).not.toEqual([])
  expect(contributingInputs.filter((path) => /(?:^|\/)packages\/core\/dist\//.test(path))).toEqual(
    []
  )
  expect(
    contributingInputs.filter((path) =>
      /packages\/motion-runtime\/dist\/(?:dom|drivers|vanilla\d*|vue)\.js$/.test(path)
    )
  ).toEqual([])
  expect(contributingInputs.some((path) => `/${path}`.includes('/node_modules/vue/'))).toBeFalse()

  expect(bundledSource).not.toContain('Vue Motion runtime cleanup failed')
  expect(bundledSource).not.toContain('Vanilla Motion cleanup failed')
})
