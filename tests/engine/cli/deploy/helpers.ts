import { mock } from 'bun:test'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { SceneGraph } from '@open-pencil/scene-graph'

const SCENARIOS = [
  'production-http',
  'http-to-https',
  'https-to-http',
  'missing-with-override',
  'static'
] as const
const TARGETS = ['react', 'vue'] as const

export type DeployRuntimeScenario = (typeof SCENARIOS)[number]
export type DeployRuntimeTarget = (typeof TARGETS)[number]

const ROOT = resolve(import.meta.dir, '../../../..')
const PROVIDER_URL = 'https://api.netlify.com/api/v1/sites/local-preflight-site/deploys'

/** Isolate module mocks, process.exit, public build variables, and fetch in a child process. */
export async function runDeployRuntimeScenario(
  scenario: DeployRuntimeScenario,
  target: DeployRuntimeTarget
): Promise<{
  exitCode: number
  stdout: string
  stderr: string
  requests: string[]
}> {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-cli-preflight-'))
  const requestsPath = join(directory, 'requests.jsonl')
  const child = Bun.spawn([process.execPath, import.meta.path, scenario, target, requestsPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      OPENPENCIL_DEPLOY_RUNTIME_MODE: 'explicit',
      OPENPENCIL_DEPLOY_SUPABASE_URL: '',
      OPENPENCIL_DEPLOY_SUPABASE_PUBLISHABLE_KEY: '',
      OPENPENCIL_DEPLOY_SUPABASE_ANON_KEY: '',
      OPENPENCIL_DEPLOY_SUPABASE_SCHEMA: ''
    },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const timeout = setTimeout(() => child.kill(), 30_000)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])
    let requests: string[] = []
    try {
      requests = readFileSync(requestsPath, 'utf8').trim().split('\n').filter(Boolean)
    } catch (cause) {
      if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause
    }
    return { exitCode, stdout, stderr, requests }
  } finally {
    clearTimeout(timeout)
    rmSync(directory, { recursive: true, force: true })
  }
}

function scenarioGraph(scenario: DeployRuntimeScenario): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected the default SceneGraph page')
  if (scenario === 'missing-with-override') {
    graph.createNode('LIST', page.id, {
      interactiveProps: {
        dataSourceRef: { kind: 'supabaseQuery', query: { table: 'products' } }
      }
    })
  } else {
    graph.createNode('RECTANGLE', page.id, { width: 100, height: 100 })
  }
  if (scenario !== 'static' && scenario !== 'missing-with-override') {
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: scenario === 'https-to-http' ? 'https://design.supabase.co' : 'http://127.0.0.1:54321',
        anonKey: 'sb_publishable_design_fixture',
        schema: 'public'
      }
    })
  }
  return graph
}

function providerDouble(requestsPath: string): typeof fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input)
      appendFileSync(requestsPath, `${JSON.stringify({ url, method: init?.method })}\n`)
      if (url !== PROVIDER_URL || init?.method !== 'POST') {
        throw new Error('Unexpected network request in the isolated CLI deployment test')
      }
      const body: unknown = JSON.parse(String(init.body))
      if (
        !body ||
        typeof body !== 'object' ||
        !('files' in body) ||
        !body.files ||
        typeof body.files !== 'object' ||
        !Object.hasOwn(body.files, '/index.html') ||
        Object.keys(body.files).some((path) => path.includes('openpencil-server/'))
      ) {
        throw new Error('Static deployment payload must contain only browser files')
      }
      return Response.json({
        id: 'local-preflight-deploy',
        ssl_url: 'https://local-preflight.invalid',
        required: []
      })
    },
    {
      preconnect: () => {
        throw new Error('Unexpected preconnect in the isolated CLI deployment test')
      }
    }
  )
}

async function runIsolatedCommand(): Promise<void> {
  const scenario = SCENARIOS.find((value) => value === process.argv[2])
  const target = TARGETS.find((value) => value === process.argv[3])
  const requestsPath = process.argv[4]
  if (!scenario || !target || !requestsPath) throw new Error('Invalid CLI test scenario')
  const graph = scenarioGraph(scenario)
  mock.module('#cli/headless', () => ({ loadDocument: async () => graph }))
  globalThis.fetch = providerDouble(requestsPath)
  const { default: command } = await import('#cli/commands/deploy')
  if (!command.run) throw new Error('CLI deploy command run is missing')
  let override: string | undefined
  if (scenario === 'http-to-https' || scenario === 'missing-with-override') {
    override = 'https://override.supabase.co'
  } else if (scenario === 'https-to-http') {
    override = 'http://127.0.0.1:54321'
  }
  await command.run({
    args: {
      _: [],
      file: join(tmpdir(), 'openpencil-cli-preflight-memory.fig'),
      provider: 'netlify',
      environment: 'production',
      token: 'local-fixture-not-a-real-token',
      site: 'local-preflight-site',
      target,
      json: true,
      ...(override
        ? {
            'supabase-url': override,
            'supabase-publishable-key': 'sb_publishable_override_fixture',
            'supabase-schema': 'app'
          }
        : {})
    },
    rawArgs: [],
    cmd: command
  })
}

if (import.meta.main) await runIsolatedCommand()
