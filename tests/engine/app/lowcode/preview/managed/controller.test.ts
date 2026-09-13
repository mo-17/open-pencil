import { describe, expect, test } from 'bun:test'

import { NESTJS_BACKEND_PROVIDER_DESCRIPTOR } from '@open-pencil/compiler/backend'
import type {
  ManagedPreviewConfig,
  ManagedPreviewPlan,
  ManagedPreviewState
} from '@open-pencil/compiler/managed-preview'

import type { ManagedBackendSnapshot } from '@/app/lowcode/preview-pane/managed-backend/capture'
import {
  createManagedBackendPreviewController,
  DEFAULT_MANAGED_PREVIEW_CONFIG
} from '@/app/lowcode/preview-pane/managed-backend/controller'

const config: ManagedPreviewConfig = {
  ...DEFAULT_MANAGED_PREVIEW_CONFIG,
  audience: 'notes-api',
  jwksURL: 'https://issuer.example/jwks'
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function snapshot(digest: string, isCurrent: () => boolean): ManagedBackendSnapshot {
  return {
    application: {
      format: 'openpencil.backend-application',
      version: 1,
      applicationId: 'managed-notes',
      dataModel: { version: 1, entities: [], enums: [], relations: [] },
      auth: { version: 1, identities: [], roles: [], ownership: [], tenants: [], rowAccess: [] },
      workflows: { version: 1, workflows: [] },
      capabilities: [],
      secrets: []
    },
    selection: {
      enabled: true,
      descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: 'A'.repeat(43)
    },
    applicationDigest: digest,
    loginPath: '/login',
    assertCurrent() {
      if (!isCurrent()) throw new Error('Document or Provider changed.')
    }
  }
}

function fixture() {
  const calls: string[] = []
  let revision = 1
  let kind: ManagedPreviewPlan['kind'] = 'initial'
  let allowed = true
  let stopFailure = false
  let terminal: ((message: string) => void) | undefined
  let pendingPrepare: ReturnType<typeof deferred<ManagedPreviewState>> | null = null
  let captured = snapshot('A'.repeat(43), () => true)
  const entered = deferred<undefined>()
  let state: ManagedPreviewState = {
    sessionId: 'session',
    phase: 'empty',
    initialized: false,
    applicationId: null,
    applicationDigest: null,
    connection: null,
    plan: null
  }
  const updated = () => ({
    ...state,
    plan: null,
    initialized: true,
    phase: 'prepared' as const,
    applicationDigest: captured.applicationDigest
  })
  const host = {
    async prepare(next: ManagedBackendSnapshot) {
      calls.push('prepare')
      entered.resolve(undefined)
      captured = next
      state = {
        ...state,
        phase: kind === 'blocked' ? 'blocked' : 'prepared',
        applicationId: next.application.applicationId,
        plan: {
          planId: `plan-${revision}`,
          kind,
          fromApplicationDigest: state.applicationDigest,
          toApplicationDigest: next.applicationDigest,
          sql: kind === 'runtime' ? '' : 'ALTER TABLE notes ADD COLUMN summary text;',
          summary: ['Add a summary field'],
          diagnostics: [],
          requiresApproval: kind !== 'runtime'
        }
      }
      return pendingPrepare ? pendingPrepare.promise : state
    },
    async setup(planId: string) {
      calls.push(`setup:${planId}`)
      state = updated()
      return state
    },
    async apply(planId: string) {
      calls.push(`apply:${planId}`)
      state = updated()
      return state
    },
    async start() {
      calls.push('start')
      state = {
        ...state,
        phase: 'running',
        connection: {
          previewPort: 5181,
          apiPort: 3012,
          apiBasePath: '/api',
          applicationId: 'managed-notes',
          applicationDigest: captured.applicationDigest
        }
      }
      return state
    },
    async stop() {
      calls.push('stop')
      if (stopFailure) throw new Error('Private runtime failure detail')
      state = { ...state, connection: null, phase: 'stopped' }
      return state
    },
    async status() {
      return state
    },
    async dispose() {
      calls.push('dispose')
    }
  }
  const controller = createManagedBackendPreviewController({
    createHost: (options) => {
      terminal = options.onTerminal
      return host
    },
    capture: async (isCurrent) => {
      if (!allowed) throw new Error('Provider is disabled.')
      return snapshot(String(revision).padStart(42, 'A') + 'A', isCurrent)
    },
    stopFrontend: async () => {
      calls.push('frontend-stop')
    },
    connectFrontend: async ({ connection }) => {
      calls.push(`frontend:${connection.apiPort}:${connection.applicationDigest}`)
    }
  })
  return {
    controller,
    calls,
    change(nextKind: ManagedPreviewPlan['kind']) {
      revision++
      kind = nextKind
    },
    denyProvider() {
      allowed = false
    },
    allowProvider() {
      allowed = true
    },
    terminate() {
      terminal?.('The managed backend process stopped unexpectedly.')
    },
    failStop() {
      stopFailure = true
    },
    hold() {
      pendingPrepare = deferred<ManagedPreviewState>()
      return pendingPrepare
    },
    result() {
      return state
    },
    entered: entered.promise
  }
}

async function running() {
  const testCase = fixture()
  await testCase.controller.prepare(config)
  await testCase.controller.confirm('plan-1')
  await testCase.controller.start()
  return testCase
}

describe('managed Backend lifecycle controls', () => {
  test('failed native cleanup revokes Start and is contained for stop and invalidation', async () => {
    const { controller, failStop } = await running()
    failStop()
    await controller.stop()
    expect(controller.canStart.value).toBe(false)
    expect(controller.state.value?.connection).toBeNull()
    expect(controller.message.value).toContain('Could not stop')
    expect(controller.message.value).not.toContain('Private runtime')
    expect(controller.error.value).toBe(controller.message.value)
    expect(controller.logs.value.at(-1)).toBe(controller.error.value)
    await controller.invalidate()
    expect(controller.enabled.value).toBe(false)
    expect(controller.message.value).toContain('Could not stop')
    expect(controller.error.value).toBe(controller.message.value)
  })

  test('runtime termination exposes an actionable error and preparation clears it', async () => {
    const { controller, terminate } = await running()
    terminate()
    expect(controller.error.value).toContain('stopped unexpectedly')
    expect(controller.logs.value.at(-1)).toBe(controller.error.value)
    expect(controller.canStart.value).toBe(false)
    expect(controller.state.value?.connection).toBeNull()
    await controller.prepare(config)
    expect(controller.error.value).toBeNull()
  })

  test('failed preparation reports an error separately from normal status and supports retry', async () => {
    const { controller, denyProvider, allowProvider } = fixture()
    denyProvider()
    await controller.prepare(config)
    expect(controller.error.value).toBe('Provider is disabled.')
    allowProvider()
    await controller.prepare(config)
    expect(controller.error.value).toBeNull()
    expect(controller.plan.value?.kind).toBe('initial')
  })

  test('preparation cannot install dependencies or execute SQL before explicit plan confirmation', async () => {
    const { controller, calls } = fixture()
    await controller.prepare(config)
    expect(controller.plan.value?.kind).toBe('initial')
    expect(calls).toEqual(['frontend-stop', 'prepare'])
    await controller.confirm('a-different-plan')
    expect(calls).toHaveLength(2)
    await controller.confirm('plan-1')
    expect(calls).toContain('setup:plan-1')
    expect(calls).not.toContain('start')
    expect(controller.canStart.value).toBe(true)
    await controller.start()
    expect(calls).toContain('start')
    expect(controller.state.value?.connection?.apiPort).toBe(3012)
    await controller.stop()
    expect(controller.state.value?.initialized).toBe(true)
    expect(controller.state.value?.connection).toBeNull()
    expect(controller.canStart.value).toBe(true)
  })

  test('schema-free updates rebuild and restart automatically after managed operation was enabled', async () => {
    const { controller, calls, change } = await running()
    change('runtime')
    const before = calls.length
    await controller.prepare(config, true)
    expect(calls.slice(before, before + 2)).toEqual(['frontend-stop', 'stop'])
    expect(calls).toContain('apply:plan-2')
    expect(controller.state.value?.phase).toBe('running')
    expect(controller.plan.value).toBeNull()
  })

  test('DDL changes stop the old backend and require the displayed plan before restarting', async () => {
    const { controller, calls, change } = await running()
    change('migration')
    await controller.prepare(config, true)
    expect(controller.state.value?.connection).toBeNull()
    expect(controller.plan.value?.sql).toContain('ALTER TABLE')
    expect(calls).not.toContain('apply:plan-2')
    await controller.confirm('plan-2')
    expect(calls).toContain('apply:plan-2')
    expect(controller.state.value?.phase).toBe('running')
  })

  test('stopping during SQL review cannot turn the pending migration into permission to start', async () => {
    const { controller, calls, change } = await running()
    change('migration')
    await controller.prepare(config, true)
    const starts = calls.filter((call) => call === 'start').length
    await controller.stop()
    expect(controller.canStart.value).toBe(false)
    expect(controller.message.value).toContain('Prepare again')
    await controller.start()
    expect(calls.filter((call) => call === 'start')).toHaveLength(starts)
  })

  test('blocked changes never call apply or reset the managed database', async () => {
    const { controller, calls, change } = await running()
    change('blocked')
    await controller.prepare(config, true)
    await controller.confirm('plan-2')
    expect(controller.message.value).toContain('manual migration')
    expect(calls).not.toContain('apply:plan-2')
    expect(controller.state.value?.connection).toBeNull()
  })

  test('configuration invalidation prevents an in-flight preparation from publishing a review', async () => {
    const { controller, hold, result, entered } = fixture()
    const pending = hold()
    const preparing = controller.prepare(config)
    await entered
    await controller.invalidate('Settings changed.')
    pending.resolve(result())
    await preparing
    expect(controller.plan.value).toBeNull()
    expect(controller.enabled.value).toBe(false)
    expect(controller.message.value).toBe('Settings changed.')
  })

  test('Provider revocation clears the writable frontend and prevents restart', async () => {
    const { controller, calls, denyProvider } = await running()
    denyProvider()
    const before = calls.filter((call) => call === 'start').length
    await controller.prepare(config, true)
    await controller.start()
    expect(controller.message.value).toContain('Provider is disabled')
    expect(controller.state.value?.connection).toBeNull()
    expect(controller.canStart.value).toBe(false)
    expect(calls.filter((call) => call === 'start')).toHaveLength(before)
  })
})
