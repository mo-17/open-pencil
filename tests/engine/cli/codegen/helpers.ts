import { mock } from 'bun:test'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

import { SceneGraph } from '@open-pencil/scene-graph'

const COMMANDS = ['compile', 'build', 'deploy'] as const
const TARGETS = ['react', 'vue'] as const
const SCENARIOS = [
  'missing-file',
  'no-pages',
  'bad-page',
  'unsupported-feature',
  'compiler-policy-error',
  'empty-compiler-seam',
  'load-rejection',
  'success'
] as const

type CodegenCommand = (typeof COMMANDS)[number]
type CodegenTarget = (typeof TARGETS)[number]
type CodegenScenario = (typeof SCENARIOS)[number]

const ROOT = resolve(import.meta.dir, '../../../..')
const SENTINEL = 'preserve this existing output file'

function readLines(path: string): string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
}

/** Actual command/compiler/build in an isolated process; only document loading
 * and network are doubles, except the explicitly named empty Compiler seam. */
export async function runCodegenScenario(
  command: CodegenCommand,
  scenario: CodegenScenario,
  target: CodegenTarget
): Promise<{
  exitCode: number
  stdout: string
  stderr: string
  events: string[]
  requests: string[]
  outputDirectory: string
  temporaryDirectory: string
  outputEntries: string[]
  sentinelPreserved: boolean
  temporaryEntries: string[]
}> {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-codegen-test-'))
  const temporaryDirectory = join(directory, 'child-tmp')
  const outputDirectory = join(directory, 'output')
  const eventsPath = join(directory, 'events.log')
  const requestsPath = join(directory, 'requests.log')
  const sentinelPath = join(outputDirectory, 'keep.txt')
  mkdirSync(temporaryDirectory)
  mkdirSync(outputDirectory)
  if (scenario !== 'success') writeFileSync(sentinelPath, SENTINEL)
  const child = Bun.spawn(
    [process.execPath, import.meta.path, command, scenario, target, eventsPath],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        TMPDIR: temporaryDirectory,
        TEMP: temporaryDirectory,
        TMP: temporaryDirectory,
        OPENPENCIL_DEPLOY_RUNTIME_MODE: 'explicit',
        OPENPENCIL_DEPLOY_SUPABASE_URL: '',
        OPENPENCIL_DEPLOY_SUPABASE_PUBLISHABLE_KEY: '',
        OPENPENCIL_DEPLOY_SUPABASE_ANON_KEY: '',
        OPENPENCIL_DEPLOY_SUPABASE_SCHEMA: ''
      },
      stdout: 'pipe',
      stderr: 'pipe'
    }
  )
  const timeout = setTimeout(() => child.kill(), 30_000)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])
    return {
      exitCode,
      stdout,
      stderr,
      events: readLines(eventsPath),
      requests: readLines(requestsPath),
      outputDirectory,
      temporaryDirectory,
      outputEntries: readdirSync(outputDirectory, { recursive: true })
        .map((entry) => entry.split(sep).join('/'))
        .sort(),
      sentinelPreserved:
        existsSync(sentinelPath) && readFileSync(sentinelPath, 'utf8') === SENTINEL,
      temporaryEntries: readdirSync(temporaryDirectory).sort()
    }
  } finally {
    clearTimeout(timeout)
    rmSync(directory, { recursive: true, force: true })
  }
}

function scenarioGraph(scenario: CodegenScenario): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected the default SceneGraph page')
  if (scenario === 'no-pages') {
    graph.deleteNode(page.id)
    return graph
  }
  graph.createNode('RECTANGLE', page.id, { width: 100, height: 100 })
  if (scenario === 'compiler-policy-error') {
    graph.updateNode(graph.rootId, { lowcodeSeoMetadata: { title: 'Fixture title' } })
  }
  return graph
}

function rejectNetwork(requestsPath: string): typeof fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input)
      appendFileSync(requestsPath, `${JSON.stringify({ url, method: init?.method })}\n`)
      throw new Error('Unexpected network request in the isolated codegen test')
    },
    {
      preconnect: () => {
        appendFileSync(requestsPath, 'preconnect\n')
        throw new Error('Unexpected preconnect in the isolated codegen test')
      }
    }
  )
}

async function runIsolatedCommand(): Promise<void> {
  const name = COMMANDS.find((value) => value === process.argv[2])
  const scenario = SCENARIOS.find((value) => value === process.argv[3])
  const target = TARGETS.find((value) => value === process.argv[4])
  const eventsPath = process.argv[5]
  if (!name || !scenario || !target || !eventsPath) throw new Error('Invalid codegen test scenario')
  const directory = dirname(eventsPath)
  if (resolve(tmpdir()) !== resolve(directory, 'child-tmp')) {
    throw new Error('Codegen fixture temporary directory is not isolated')
  }
  const graph = scenarioGraph(scenario)
  mock.module('#cli/headless', () => ({
    loadDocument: async () => {
      appendFileSync(eventsPath, 'load-document\n')
      if (scenario === 'load-rejection') throw new Error('Fixture document loading rejected')
      return graph
    }
  }))
  globalThis.fetch = rejectNetwork(join(directory, 'requests.log'))
  if (scenario === 'empty-compiler-seam') {
    // Current closed CLI page/target guards make an empty real Compiler result
    // unreachable. This seam preserves the defensive diagnostic/JSON contract.
    const compiler = await import('@open-pencil/compiler')
    mock.module('@open-pencil/compiler', () => ({
      ...compiler,
      compile: () => {
        appendFileSync(eventsPath, 'empty-compiler-seam\n')
        return {
          files: new Map(),
          warnings: [{ code: 'fixture-empty-output', message: 'Defensive empty Compiler seam' }]
        }
      }
    }))
  }
  const loaders = {
    compile: () => import('#cli/commands/compile'),
    build: () => import('#cli/commands/build'),
    deploy: () => import('#cli/commands/deploy')
  }
  const { default: command } = await loaders[name]()
  if (!command.run) throw new Error('CLI codegen command run is missing')
  try {
    await command.run({
      args: {
        _: [],
        file: scenario === 'missing-file' ? undefined : join(directory, 'fixture.fig'),
        out: join(directory, 'output'),
        page: scenario === 'bad-page' ? 'Missing page' : undefined,
        target,
        json: true,
        i18n: scenario === 'unsupported-feature',
        packaging: scenario === 'compiler-policy-error' ? 'microfrontend' : undefined,
        'app-id': scenario === 'compiler-policy-error' ? 'fixture-app' : undefined,
        provider: 'netlify',
        environment: 'production',
        token: 'local-codegen-fixture-token',
        site: 'local-codegen-fixture-site'
      },
      rawArgs: [],
      cmd: command
    })
    appendFileSync(eventsPath, 'command-returned\n')
  } catch (cause) {
    appendFileSync(eventsPath, 'command-rejected\n')
    throw cause
  }
}

if (import.meta.main) await runIsolatedCommand()
