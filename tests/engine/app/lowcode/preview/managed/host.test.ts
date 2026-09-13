import { describe, expect, test } from 'bun:test'

import type {
  ManagedPreviewCommand,
  ManagedPreviewConfig,
  ManagedPreviewState
} from '@open-pencil/compiler/managed-preview'

import { captureManagedBackendSnapshot } from '@/app/lowcode/preview-pane/managed-backend/capture'
import { createManagedBackendPreviewHost } from '@/app/lowcode/preview-pane/managed-backend/host'
import type {
  ManagedPreviewProcess,
  ManagedPreviewProcessCallbacks
} from '@/app/lowcode/preview-pane/managed-backend/process'

import { connectedBackendFixture } from '../connected-backend/helpers'

const SESSION = 'c8f08a42-c2b8-4b7c-89dd-43bd648acf2f'
const CONFIG: ManagedPreviewConfig = {
  previewPort: 5181,
  apiPort: 3012,
  dbPort: 55443,
  audience: 'notes-api',
  jwksURL: 'https://127.0.0.1:18443/keys',
  caFile: '/local/ca.crt'
}

function deferred<T>() {
  let resolve: (value: T) => void = (_value: T) => {
    throw new Error('Promise was not initialized')
  }
  let reject: (error: Error) => void = (_error: Error) => {
    throw new Error('Promise was not initialized')
  }
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function fixture() {
  const connected = await connectedBackendFixture()
  let live = true
  const snapshot = await captureManagedBackendSnapshot(
    connected.graph,
    'react',
    () => live,
    () => connected.store
  )
  const commands: ManagedPreviewCommand[] = []
  let closed = 0
  let cancelled = 0
  let callbacks: ManagedPreviewProcessCallbacks | undefined
  let nextResponse: ((command: ManagedPreviewCommand) => Promise<ManagedPreviewState>) | undefined
  const state: ManagedPreviewState = {
    sessionId: SESSION,
    phase: 'prepared',
    initialized: false,
    applicationId: snapshot.application.applicationId,
    applicationDigest: null,
    connection: null,
    plan: {
      planId: snapshot.applicationDigest,
      kind: 'initial',
      fromApplicationDigest: null,
      toApplicationDigest: snapshot.applicationDigest,
      sql: 'CREATE TABLE notes ();',
      summary: ['Create notes'],
      diagnostics: [],
      requiresApproval: true
    }
  }
  const process: ManagedPreviewProcess = {
    async request(command) {
      commands.push(command)
      if (nextResponse) return nextResponse(command)
      return command.command === 'stop' ? { ...state, phase: 'stopped', plan: null } : state
    },
    cancelPending() {
      cancelled += 1
    },
    async close() {
      closed += 1
    }
  }
  const events: unknown[] = []
  const env = {
    isDesktop: () => true,
    resolveSession: () => SESSION,
    startProcess: async (_id: string, current?: ManagedPreviewProcessCallbacks) => {
      callbacks = current
      return process
    }
  }
  const host = createManagedBackendPreviewHost({ onEvent: (event) => events.push(event) }, env)
  return {
    host,
    snapshot,
    process,
    env,
    state,
    commands,
    events,
    invalidate() {
      live = false
    },
    closed: () => closed,
    cancelled: () => cancelled,
    callbacks: () => callbacks,
    respond(handler: (command: ManagedPreviewCommand) => Promise<ManagedPreviewState>) {
      nextResponse = handler
    }
  }
}

describe('managed desktop host authority and lifetime', () => {
  test('sends only public application/config data and consumes the displayed plan', async () => {
    const item = await fixture()
    await item.host.prepare(item.snapshot, CONFIG)
    expect(item.commands.map(({ command }) => command)).toEqual(['stop', 'prepare'])
    const prepare = item.commands[1]
    expect(Object.keys(prepare).sort()).toEqual([
      'application',
      'command',
      'config',
      'id',
      'version'
    ])
    await expect(item.host.setup('different-plan')).rejects.toThrow('no longer current')
    expect(item.commands.length).toBe(2)
    await item.host.setup(item.snapshot.applicationDigest)
    expect(item.commands[2]).toMatchObject({
      command: 'setup',
      planId: item.snapshot.applicationDigest
    })
    await item.host.dispose()
    expect(item.closed()).toBe(1)
  })

  test('revocation is checked immediately before applying reviewed SQL', async () => {
    const item = await fixture()
    await item.host.prepare(item.snapshot, CONFIG)
    item.invalidate()
    await expect(item.host.setup(item.snapshot.applicationDigest)).rejects.toThrow(
      'document changed'
    )
    expect(item.commands.some(({ command }) => command === 'setup')).toBe(false)
    await item.host.dispose()
  })

  test('stop interrupts an outstanding setup without waiting for its completion', async () => {
    const item = await fixture()
    await item.host.prepare(item.snapshot, CONFIG)
    const setup = deferred<ManagedPreviewState>()
    item.respond(async (command) =>
      command.command === 'setup' ? setup.promise : { ...item.state, phase: 'stopped' }
    )
    const installing = item.host.setup(item.snapshot.applicationDigest)
    void installing.catch(() => undefined)
    await Promise.resolve()
    await item.host.stop()
    expect(item.commands.at(-1)?.command).toBe('stop')
    expect(item.cancelled()).toBeGreaterThan(0)
    setup.resolve(item.state)
    await expect(installing).rejects.toThrow('changed while')
    await item.host.dispose()
  })

  test('dispose during native startup closes the arriving child before sending prepare', async () => {
    const item = await fixture()
    const started = deferred<ManagedPreviewProcess>()
    const host = createManagedBackendPreviewHost(
      {},
      { ...item.env, startProcess: () => started.promise }
    )
    const preparing = host.prepare(item.snapshot, CONFIG)
    void preparing.catch(() => undefined)
    await Promise.resolve()
    const closing = host.dispose()
    started.resolve(item.process)
    await closing
    await expect(preparing).rejects.toThrow('changed while')
    expect(item.commands.length).toBe(0)
    expect(item.closed()).toBe(1)
  })

  test('a running API connection must match the approved application and ports', async () => {
    const item = await fixture()
    await item.host.prepare(item.snapshot, CONFIG)
    item.respond(async () => ({
      ...item.state,
      phase: 'running',
      initialized: true,
      applicationDigest: item.snapshot.applicationDigest,
      plan: null,
      connection: {
        previewPort: 5181,
        apiPort: 9999,
        apiBasePath: '/api',
        applicationId: item.snapshot.application.applicationId,
        applicationDigest: item.snapshot.applicationDigest
      }
    }))
    await expect(item.host.start()).rejects.toThrow('different Backend connection')
    await item.host.dispose()
  })

  test('browser use and persistence failure cannot spawn a companion', async () => {
    const item = await fixture()
    const browser = createManagedBackendPreviewHost({}, { ...item.env, isDesktop: () => false })
    await expect(browser.prepare(item.snapshot, CONFIG)).rejects.toThrow('desktop editor')
    const denied = createManagedBackendPreviewHost(
      {},
      {
        ...item.env,
        resolveSession() {
          throw new Error('Storage unavailable')
        }
      }
    )
    await expect(denied.prepare(item.snapshot, CONFIG)).rejects.toThrow('Storage unavailable')
    expect(item.commands).toEqual([])
  })
})
