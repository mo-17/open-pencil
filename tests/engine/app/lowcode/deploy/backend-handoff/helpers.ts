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
import { dirname, join, resolve } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { BACKEND_ARTIFACT_MANIFEST_PATH } from '@open-pencil/compiler/backend'
import type { BackendArtifactManifestV1 } from '@open-pencil/compiler/backend'
import { exportFigFileWithOptions } from '@open-pencil/core/io/formats/fig'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import { SceneGraph } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
} from '@/app/plugins/host/backend-provider'
import { VERCEL_DEPLOYMENT_PLUGIN } from '@/app/plugins/host/deployment/contract'
import {
  createDeploymentPluginHostAdapter,
  type DeploymentPluginReview,
  type DeploymentPluginResult
} from '@/app/plugins/host/deployment/provider'

import { loadDocument } from '#cli/headless'

const ROOT = resolve(import.meta.dir, '../../../../../..')
const READY_PREFIX = 'OPENPENCIL_BACKEND_READY '
const PROVIDER_URL = 'https://api.vercel.com/v13/deployments'
const PROVIDER_FILES_URL = 'https://api.vercel.com/v2/files'
const SCENARIOS = [
  'success',
  'fragmented',
  'disabled-ready',
  'changed-ready',
  'spawn-failure',
  'provider-failure',
  'raw-react',
  'raw-vue'
] as const
export type BridgeScenario = (typeof SCENARIOS)[number]

interface ProviderObservation {
  url: string
  method?: string
  staticPaths: string[]
  manifest: BackendArtifactManifestV1
  manifestDigest: string
  migrationProposal: string
}

interface HostReport {
  review: DeploymentPluginReview
  markerCount: number
  legacyHasBackendManifest: boolean
  result?: DeploymentPluginResult
  error?: { name: string; message: string; code?: string }
}

export interface BridgeResult {
  exitCode: number
  stdout: string
  stderr: string
  cliStdout: string
  cliStderr: string
  events: string[]
  requests: ProviderObservation[]
  report: HostReport
  temporaryEntries: string[]
}

function record(directory: string, event: string): void {
  appendFileSync(join(directory, 'events.log'), `${event}\n`)
}

function readLines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean) : []
}

/** Only the native transport is replaced; the nested CLI loads the actual .fig and builds in TMPDIR. */
export async function runBackendHandoffBridge(scenario: BridgeScenario): Promise<BridgeResult> {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-handoff-bridge-'))
  const temporaryDirectory = join(directory, 'child-tmp')
  mkdirSync(temporaryDirectory)
  const child = Bun.spawn([process.execPath, import.meta.path, scenario, directory], {
    cwd: ROOT,
    env: {
      ...process.env,
      TMPDIR: temporaryDirectory,
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
      OPENPENCIL_BRIDGE_ROLE: 'host',
      OPENPENCIL_BRIDGE_DIRECTORY: directory,
      OPENPENCIL_BRIDGE_SCENARIO: scenario
    },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const timeout = setTimeout(() => child.kill(), 40_000)
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
      cliStdout: readLines(join(directory, 'cli-stdout.log')).join('\n'),
      cliStderr: readLines(join(directory, 'cli-stderr.log')).join('\n'),
      events: readLines(join(directory, 'events.log')),
      requests: readLines(join(directory, 'requests.jsonl')).map(
        (line) => JSON.parse(line) as ProviderObservation
      ),
      report: JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')) as HostReport,
      temporaryEntries: readdirSync(temporaryDirectory).sort()
    }
  } finally {
    clearTimeout(timeout)
    rmSync(directory, { recursive: true, force: true })
  }
}

function rejectNetwork(): typeof fetch {
  return Object.assign(
    async (): Promise<Response> => {
      throw new Error('Unexpected network request in the Backend handoff bridge test')
    },
    {
      preconnect: () => {
        throw new Error('Unexpected network preconnect in the Backend handoff bridge test')
      }
    }
  )
}

function providerDouble(directory: string, scenario: string): typeof fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input)
      record(directory, `provider:${init?.method ?? 'GET'}:${url}`)
      if ((url !== PROVIDER_URL && url !== PROVIDER_FILES_URL) || init?.method !== 'POST') {
        throw new Error('Unexpected network request in the Backend handoff CLI child')
      }
      const outputNames = readdirSync(tmpdir()).filter((name) => name.startsWith('op-deploy-'))
      if (outputNames.length !== 1) throw new Error('Expected one CLI-owned build directory')
      const backend = join(tmpdir(), outputNames[0], 'openpencil-server')
      const manifestText = readFileSync(join(backend, BACKEND_ARTIFACT_MANIFEST_PATH), 'utf8')
      const manifest = JSON.parse(manifestText) as BackendArtifactManifestV1
      const proposal = manifest.artifacts.find((artifact) => artifact.kind === 'migration-plan')
      if (!proposal) throw new Error('Expected the reviewed migration proposal artifact')
      const staticPaths =
        url === PROVIDER_URL
          ? (JSON.parse(String(init.body)) as { files: { file: string }[] }).files
              .map((entry) => `/${entry.file}`)
              .sort()
          : []
      const observation: ProviderObservation = {
        url,
        method: init.method,
        staticPaths,
        manifest,
        manifestDigest: new Bun.CryptoHasher('sha256').update(manifestText).digest('base64url'),
        migrationProposal: readFileSync(join(backend, proposal.path), 'utf8')
      }
      appendFileSync(join(directory, 'requests.jsonl'), `${JSON.stringify(observation)}\n`)
      if (scenario === 'provider-failure') {
        return new Response('Local provider failure fixture', { status: 503 })
      }
      return Response.json(
        url === PROVIDER_FILES_URL
          ? {}
          : {
              id: 'local-handoff-deploy',
              url: 'local-handoff.invalid'
            }
      )
    },
    { preconnect: rejectNetwork().preconnect }
  )
}

type OutputListener = (value: string) => void
type CloseListener = (value: { code: number | null }) => void
type ErrorListener = (value: string) => void

/** Models Tauri's event API around a real Bun process, including writes without closing stdin. */
class BunShellCommand {
  private stdoutListeners: OutputListener[] = []
  private stderrListeners: OutputListener[] = []
  private closeListeners: CloseListener[] = []
  private errorListeners: ErrorListener[] = []
  readonly stdout = {
    on: (_event: string, listener: OutputListener) => this.stdoutListeners.push(listener),
    off: (_event: string, listener: OutputListener) => {
      this.stdoutListeners = this.stdoutListeners.filter((entry) => entry !== listener)
    }
  }
  readonly stderr = {
    on: (_event: string, listener: OutputListener) => this.stderrListeners.push(listener),
    off: (_event: string, listener: OutputListener) => {
      this.stderrListeners = this.stderrListeners.filter((entry) => entry !== listener)
    }
  }

  constructor(
    private readonly args: string[],
    private readonly options: { cwd: string; env: Record<string, string> },
    private readonly directory: string,
    private readonly scenario: BridgeScenario,
    private readonly beforeReady: () => Promise<void>
  ) {}

  on(event: 'close', listener: CloseListener): void
  on(event: 'error', listener: ErrorListener): void
  on(event: 'close' | 'error', listener: CloseListener | ErrorListener): void {
    if (event === 'close') this.closeListeners.push(listener as CloseListener)
    else this.errorListeners.push(listener as ErrorListener)
  }

  off(event: 'close', listener: CloseListener): void
  off(event: 'error', listener: ErrorListener): void
  off(event: 'close' | 'error', listener: CloseListener | ErrorListener): void {
    if (event === 'close')
      this.closeListeners = this.closeListeners.filter((entry) => entry !== listener)
    else this.errorListeners = this.errorListeners.filter((entry) => entry !== listener)
  }

  private async pump(stream: ReadableStream<Uint8Array>, stdout: boolean): Promise<void> {
    const decoder = new TextDecoder()
    const listeners = stdout ? this.stdoutListeners : this.stderrListeners
    let buffered = ''
    const deliver = async (line: string): Promise<void> => {
      appendFileSync(join(this.directory, stdout ? 'cli-stdout.log' : 'cli-stderr.log'), line)
      if (stdout && line.startsWith(READY_PREFIX)) {
        record(this.directory, 'ready')
        await this.beforeReady()
      }
      if (this.scenario === 'fragmented' && stdout) {
        for (let start = 0; start < line.length; start += 7) {
          for (const listener of listeners) listener(line.slice(start, start + 7))
        }
      } else {
        for (const listener of listeners) listener(line)
      }
    }
    for await (const chunk of stream) {
      buffered += decoder.decode(chunk, { stream: true })
      let newline = buffered.indexOf('\n')
      while (newline >= 0) {
        await deliver(buffered.slice(0, newline + 1))
        buffered = buffered.slice(newline + 1)
        newline = buffered.indexOf('\n')
      }
    }
    buffered += decoder.decode()
    if (buffered) await deliver(buffered)
  }

  async spawn() {
    record(this.directory, 'spawn')
    if (this.scenario === 'spawn-failure') throw new Error('Local shell spawn fixture failed')
    const child = Bun.spawn([process.execPath, '--preload', import.meta.path, ...this.args], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        ...this.options.env,
        OPENPENCIL_BRIDGE_ROLE: 'provider'
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const deadline = setTimeout(() => child.kill(), 30_000)
    void Promise.all([this.pump(child.stdout, true), this.pump(child.stderr, false), child.exited])
      .then(([, , code]) => {
        clearTimeout(deadline)
        record(this.directory, `close:${code}`)
        for (const listener of this.closeListeners) listener({ code })
        return undefined
      })
      .catch((cause: unknown) => {
        clearTimeout(deadline)
        child.kill()
        for (const listener of this.errorListeners) listener(String(cause))
      })
    return {
      write: async (data: string | number[] | Uint8Array) => {
        const text =
          typeof data === 'string' ? data : new TextDecoder().decode(new Uint8Array(data))
        const message: unknown = JSON.parse(text)
        const stage =
          message !== null &&
          typeof message === 'object' &&
          'stage' in message &&
          typeof message.stage === 'string'
            ? message.stage
            : 'handoff'
        record(this.directory, stage)
        child.stdin.write(text)
        await child.stdin.flush()
      },
      kill: async () => {
        record(this.directory, 'kill')
        child.kill()
        await child.exited
      }
    }
  }
}

function application(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'reviewed-handoff-application',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'reviewed_notes',
          name: 'reviewed_notes',
          management: 'managed',
          fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
          primaryKey: { fields: ['id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: { version: 1, identities: [], roles: [], ownership: [], tenants: [], rowAccess: [] },
    workflows: { version: 1, workflows: [] },
    capabilities: [{ capability: 'migrations.schema', required: true }],
    secrets: []
  }
}

async function hostFixture(directory: string) {
  const bundle = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (!bundle) throw new Error('Missing bundled Backend Provider')
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundle],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  const loaded = await store.load()
  if (loaded.error) throw loaded.error
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active Backend Provider')
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Missing fixture page')
  graph.createNode('RECTANGLE', page.id, { width: 100, height: 100 })
  const declaration = {
    format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
    selection: descriptor,
    application: application()
  }
  const setDeclaration = () =>
    graph.updateNode(graph.rootId, {
      pluginData: [
        {
          pluginId: APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
          key: APP_BACKEND_PROVIDER_DOCUMENT_KEY,
          value: appBackendProviderDocumentValue(declaration)
        }
      ]
    })
  setDeclaration()
  const path = join(directory, 'reviewed.fig')
  await Bun.write(path, await exportFigFileWithOptions(graph, { profile: 'roundtrip' }))
  const restored = await loadDocument(path)
  const markerCount =
    restored
      .getNode(restored.rootId)
      ?.pluginData.filter((entry) => entry.key === APP_BACKEND_PROVIDER_DOCUMENT_KEY).length ?? 0
  const legacyHasBackendManifest = compile({
    graph,
    pageIds: [page.id],
    fontManifest: { faces: [] },
    options: withDefaults({ devMode: false })
  }).files.has(BACKEND_ARTIFACT_MANIFEST_PATH)
  const editor = {
    graph,
    getDocumentPath: () => path,
    getSourceIdentity: () => ({ handle: null, path }),
    getStorageBinding: () => null
  } as EditorStore
  return {
    store,
    graph,
    path,
    declaration,
    setDeclaration,
    editor,
    markerCount,
    legacyHasBackendManifest
  }
}

async function runHost(scenario: BridgeScenario, directory: string): Promise<void> {
  globalThis.fetch = rejectNetwork()
  Object.defineProperty(globalThis, '__OPENPENCIL_PROJECT_ROOT__', { value: ROOT })
  const fixture = await hostFixture(directory)
  const beforeReady = async () => {
    if (scenario === 'disabled-ready') {
      await fixture.store.setEnabled(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, false)
      record(directory, 'disabled')
    } else if (scenario === 'changed-ready') {
      fixture.declaration.application.applicationId = 'changed-after-review'
      fixture.setDeclaration()
      record(directory, 'changed')
    }
  }
  mock.module('@tauri-apps/plugin-shell', () => ({
    Command: {
      create: (
        name: string,
        args: string[],
        options: { cwd: string; env: Record<string, string> }
      ) => {
        if (
          name !== 'lowcode-preview' ||
          options.cwd !== ROOT ||
          args.includes('test-only-test-only')
        ) {
          throw new Error('Unexpected Desktop CLI invocation in the bridge test')
        }
        return new BunShellCommand(args, options, directory, scenario, beforeReady)
      }
    }
  }))
  const adapter = createDeploymentPluginHostAdapter(
    VERCEL_DEPLOYMENT_PLUGIN,
    { resolve: async () => 'test-only-test-only' },
    undefined,
    undefined,
    fixture.store
  )
  const parameters = { environment: 'production', target: 'local-handoff-site' }
  const report: HostReport = {
    review: adapter.review(fixture.editor, parameters),
    markerCount: fixture.markerCount,
    legacyHasBackendManifest: fixture.legacyHasBackendManifest
  }
  if (scenario === 'raw-react' || scenario === 'raw-vue') {
    const child = Bun.spawn(
      [
        process.execPath,
        '--preload',
        import.meta.path,
        'packages/cli/src/index.ts',
        'compile',
        fixture.path,
        '-o',
        join(tmpdir(), 'raw-output'),
        '--target',
        scenario === 'raw-react' ? 'react' : 'vue',
        '--json'
      ],
      {
        cwd: ROOT,
        env: { ...process.env, OPENPENCIL_BRIDGE_ROLE: 'provider' },
        stdout: 'pipe',
        stderr: 'pipe'
      }
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report))
    process.stdout.write(stdout)
    process.stderr.write(stderr)
    process.exitCode = code
    return
  }
  try {
    report.result = await adapter.execute(fixture.editor, parameters, {
      expectedReview: report.review,
      confirm: () => {
        record(directory, 'confirmed')
        return true
      }
    })
  } catch (cause) {
    report.error = {
      name: cause instanceof Error ? cause.name : 'Unknown',
      message: cause instanceof Error ? cause.message : String(cause),
      ...(cause instanceof Error && 'code' in cause && typeof cause.code === 'string'
        ? { code: cause.code }
        : {})
    }
  }
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report))
}

const directory = process.env.OPENPENCIL_BRIDGE_DIRECTORY
if (process.env.OPENPENCIL_BRIDGE_ROLE === 'provider' && directory) {
  globalThis.fetch = providerDouble(directory, process.env.OPENPENCIL_BRIDGE_SCENARIO ?? '')
} else if (import.meta.main) {
  const scenario = SCENARIOS.find((value) => value === process.argv[2])
  if (!scenario || !directory || dirname(tmpdir()) !== directory)
    throw new Error('Invalid isolated Backend bridge fixture')
  await runHost(scenario, directory)
}
