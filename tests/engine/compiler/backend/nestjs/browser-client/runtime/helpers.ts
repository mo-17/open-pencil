import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { COMMAND_JOURNAL_SOURCE } from '#compiler/adapters/backend-client/command-recovery/storage'
import { buildBackendClientRuntime } from '#compiler/adapters/backend-client/runtime'
import { emitNestJSClient } from '#compiler/backend/nestjs/client'

import { browserApplication } from '../helpers'

interface PendingRequest {
  call: { url: string; init: RequestInit }
  readonly settled: boolean
  respond(value: unknown, status?: number): void
  reject(): void
}
interface TestTransport {
  pending: PendingRequest[]
  subscribe(listener: () => void): () => void
  dispose(): void
}
interface BrowserEnvironmentModule {
  configureRecovery(value: RuntimeRecoveryEnvironment): void
  events: Array<
    | { kind: 'navigation'; path: string }
    | { kind: 'alert'; role: string; text: string }
    | { kind: 'removed' }
  >
}
export interface RuntimeRecoveryEnvironment {
  indexedDB?: IDBFactory
  locks?: LockManager
  origin?: string
  storageTimeoutMs?: number
}
export interface RuntimeRequestInput {
  resourceId: string
  operation: string
  payload?: object
  limit?: number
  after?: string
  filter?: Record<string, string | number | boolean | null>
  q?: string
  sort?: string
  direction?: 'asc' | 'desc'
}
interface RuntimeModule {
  disposeTestRuntime(): void
  getSession(): { generation: number }
  setBackendState(generation: number, name: string, value: unknown, empty: unknown): void
  isCurrentGeneration(generation: number): boolean
  initializeBackendClient(): Promise<void>
  createBackendQueryState(): <Input extends RuntimeRequestInput>(input: Input) => Input
  backendCommand(input: {
    commandId: string
    payload: object
    idempotencyKeyTarget: string
    recovery?: 'browser'
  }): Promise<{ current: boolean; data?: unknown }>
  backendCommandRecovery(input: {
    commandId: string
    idempotencyKeyTarget: string
    operation: 'inspect' | 'retry' | 'acknowledge'
    attemptKey?: string
  }): Promise<{ current: boolean; data?: unknown }>
  backendRequest(
    input: RuntimeRequestInput,
    signal?: AbortSignal
  ): Promise<{ current: boolean; data: unknown }>
  watchBackendResource(
    input: RuntimeRequestInput & { operation: 'list' },
    rows: (rows: unknown[]) => void,
    cursor?: (cursor: string) => void,
    error?: (error: string) => void
  ): () => void
}

const TRANSPORT_SOURCE = `export const pending = [];
const listeners = new Set(); let closed = false;
export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
export function fetch(url,init) {
  if (closed) return Promise.resolve(new Response('{}', {headers:{'Content-Type':'application/json'}}));
  return new Promise((resolve,reject) => {
    let settled = false;
    const request = {
      call:{url,init}, get settled(){return settled},
      respond(value,status=200) { if (settled) return; settled = true; resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})) },
      reject() { if (settled) return; settled = true; reject(new Error('Synthetic private transport error')) }
    };
    pending.push(request); for (const listener of listeners) listener();
  })
}
export function dispose() { closed = true; listeners.clear(); for (const request of pending) request.respond({data:[],nextCursor:null}) }
`

export function commandAPIForTest(source: string, timeoutMs?: number): string {
  if (timeoutMs === undefined) return source
  const marker = 'const COMMAND_TIMEOUT_MS = 30_000'
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 5000 ||
    !source.includes(marker) ||
    source.indexOf(marker) !== source.lastIndexOf(marker)
  )
    throw new Error('The bounded command test deadline could not be installed.')
  return source.replace(marker, 'const COMMAND_TIMEOUT_MS = ' + timeoutMs)
}

/** Only session transitions and the browser transport are controlled; API and lifetime bodies are real generated sources. */
export async function runtimeFixture(
  initializationFailure = false,
  application = browserApplication(),
  commandTimeoutMs?: number,
  recoveryEnvironment?: RuntimeRecoveryEnvironment
) {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-backend-runtime-'))
  const write = (name: string, content: string) =>
    writeFileSync(join(directory, name + '.ts'), content)
  const read = async (name: string) => import(pathToFileURL(join(directory, name + '.ts')).href)
  try {
    write(
      'lowcode-backend-api',
      commandAPIForTest(String(emitNestJSClient(application).content), commandTimeoutMs)
    )
    write(
      'lowcode-state',
      `export const values = new Map(); export function setDocState(name,value) { values.set(name,value) }; export function getDocState(name) { return values.get(name) }`
    )
    write(
      'lowcode-backend-auth',
      `let state = Object.freeze({ready:false,signedIn:false,id:null,email:null,generation:0}); const listeners = new Set();
export function getSession(){return state}
export function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)}
export function dispose(){listeners.clear()}
export function transition(id){state=Object.freeze({ready:true,signedIn:id!==null,id,email:null,generation:state.generation+1});for(const listener of listeners)listener()}
export async function initialize(){transition(null); ${initializationFailure ? "throw new Error('synthetic-private-callback-detail')" : ''}}
export async function signOut(){transition(null)}
export async function signIn(){}
export async function getAccessToken(){return 'synthetic-session-token'}
`
    )
    write('transport', TRANSPORT_SOURCE)
    write(
      'browser',
      `export const events = [];
export const history = { replaceState(state,title,path){events.push({kind:'navigation',path})} };
export const document = { createElement(){return { style:{}, attributes:{}, setAttribute(key,value){this.attributes[key]=value}, remove(){events.push({kind:'removed'})} }}, body:{prepend(element){events.push({kind:'alert',role:element.attributes.role,text:element.textContent})}} };
export let indexedDB;
export const navigator = {};
export const location = {origin:'https://generated.test'};
export function configureRecovery(environment){ indexedDB=environment.indexedDB; navigator.locks=environment.locks; location.origin=environment.origin??'https://generated.test' }
`
    )
    if (application.commands?.commands.length) {
      const timeout = recoveryEnvironment?.storageTimeoutMs
      if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1 || timeout > 1000))
        throw new Error('Recovery storage test deadline must be bounded.')
      const source =
        timeout === undefined
          ? COMMAND_JOURNAL_SOURCE
          : COMMAND_JOURNAL_SOURCE.replace(
              'const STORAGE_TIMEOUT_MS = 5000',
              'const STORAGE_TIMEOUT_MS = ' + timeout
            )
      write(
        'lowcode-backend-command-journal',
        "import { indexedDB, navigator } from './browser'\n" + source
      )
    }
    write(
      'runtime',
      `import { fetch } from './transport'\nimport { document, history, location } from './browser'\n` +
        buildBackendClientRuntime(application, './lowcode-state') +
        '\nexport function disposeTestRuntime(){for(const controller of requests)controller.abort();requests.clear();listeners.clear();queryActions.clear()}\n'
    )
    const runtime = (await read('runtime')) as RuntimeModule
    const auth = (await read('lowcode-backend-auth')) as {
      transition(id: string | null): void
      dispose(): void
    }
    const transport = (await read('transport')) as TestTransport
    const state = (await read('lowcode-state')) as { values: Map<string, unknown> }
    const browser = (await read('browser')) as BrowserEnvironmentModule
    if (recoveryEnvironment) browser.configureRecovery(recoveryEnvironment)
    await runtime.initializeBackendClient()
    let disposed = false
    const watchers = new Set<() => void>()
    const waiting = new Set<() => void>()
    const trackedRuntime: RuntimeModule = {
      ...runtime,
      watchBackendResource: (...args) => {
        const unsubscribe = runtime.watchBackendResource(...args)
        const stop = () => {
          unsubscribe()
          watchers.delete(stop)
        }
        watchers.add(stop)
        return stop
      }
    }
    const waitForRequest = (index: number, timeoutMs = 1000): Promise<PendingRequest> => {
      if (disposed) return Promise.reject(new Error('Runtime fixture is disposed.'))
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 5000
      )
        return Promise.reject(new Error('Request wait requires a bounded index and deadline.'))
      const existing = transport.pending[index]
      if (existing) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const finish = (request?: PendingRequest) => {
          clearTimeout(timer)
          unsubscribe()
          waiting.delete(cancel)
          if (request) resolve(request)
          else
            reject(
              new Error(
                'Request ' + index + ' did not arrive before its test deadline or fixture disposal.'
              )
            )
        }
        const cancel = () => finish()
        const unsubscribe = transport.subscribe(() => {
          const request = transport.pending[index]
          if (request) finish(request)
        })
        const timer = setTimeout(cancel, timeoutMs)
        waiting.add(cancel)
      })
    }
    return {
      runtime: trackedRuntime,
      auth,
      pending: transport.pending,
      values: state.values,
      browserEvents: browser.events,
      waitForRequest,
      event: async (source: string) => {
        write(
          'event',
          "import * as __opBackend from './runtime'\nimport { setDocState } from './lowcode-state'\nexport const run = " +
            source
        )
        return (await read('event')) as { run: () => Promise<void> }
      },
      dispose: () => {
        if (disposed) return
        disposed = true
        for (const stop of watchers) stop()
        for (const cancel of waiting) cancel()
        runtime.disposeTestRuntime()
        auth.dispose()
        transport.dispose()
        rmSync(directory, { recursive: true, force: true })
      }
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
export async function tick(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}
