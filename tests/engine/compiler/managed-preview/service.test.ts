import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nestJSPreviewApplicationDigest } from '#compiler/backend/nestjs/preview-digest'
import { ManagedPreviewDirectory } from '#compiler/managed-preview/directory'
import type { ManagedSnapshot } from '#compiler/managed-preview/plan'
import type { ManagedWorkerAction } from '#compiler/managed-preview/process'
import { spawnManagedWorker } from '#compiler/managed-preview/process'
import { ManagedPreviewService } from '#compiler/managed-preview/service'

import { browserApplication } from '../backend/nestjs/browser-client/helpers'

test('reviewed setup and runtime apply commit stopped; the UI explicitly owns start', async () => {
  const root = mkdtempSync(join(tmpdir(), 'managed-service-'))
  const service = await ManagedPreviewService.create({
    sessionId: randomUUID(),
    baseDirectory: root
  })
  const actions: ManagedWorkerAction[] = []
  Object.defineProperty(service, 'worker', {
    value: async (
      snapshot: ManagedSnapshot,
      action: ManagedWorkerAction,
      _signal: AbortSignal,
      planId: string
    ) => {
      actions.push(action)
      return {
        receipt: {
          application_digest: nestJSPreviewApplicationDigest(snapshot.application),
          plan_digest: planId
        }
      }
    }
  })
  const application = browserApplication()
  const config = {
    previewPort: 5193,
    apiPort: 3019,
    dbPort: 55449,
    audience: 'notes-api',
    jwksURL: 'https://127.0.0.1:18443/certs',
    caFile: ''
  }
  try {
    const prepared = await service.execute({
      version: 1,
      id: 'prepare',
      command: 'prepare',
      application,
      config
    })
    if (!prepared.plan) throw new Error('Expected initial plan')
    const state = await service.execute({
      version: 1,
      id: 'setup',
      command: 'setup',
      planId: prepared.plan.planId
    })
    expect(state.phase).toBe('stopped')
    expect(state.connection).toBeNull()
    expect(state.initialized).toBe(true)
    expect(actions).toEqual(['install', 'build', 'setup'])
    const next = await service.execute({
      version: 1,
      id: 'prepare2',
      command: 'prepare',
      application,
      config
    })
    if (!next.plan) throw new Error('Expected runtime plan')
    const applied = await service.execute({
      version: 1,
      id: 'apply',
      command: 'apply',
      planId: next.plan.planId
    })
    expect(applied.phase).toBe('stopped')
    expect(applied.connection).toBeNull()
    expect(actions).toEqual(['install', 'build', 'setup', 'build', 'apply'])
  } finally {
    await service.execute({ version: 1, id: 'close', command: 'close' })
    rmSync(root, { recursive: true, force: true })
  }
})

test('owned API unexpected exit emits terminal state; stdin EOF terminates the worker', async () => {
  const probe = createServer()
  await new Promise<void>((resolve) => {
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('Expected test loopback port')
  const apiPort = address.port
  await new Promise<void>((resolve) => {
    probe.close(() => resolve())
  })
  const root = mkdtempSync(join(tmpdir(), 'managed-api-lifetime-'))
  const sessionId = randomUUID()
  const terminal = Promise.withResolvers<{ phase: string; connection: unknown; code: string }>()
  const service = await ManagedPreviewService.create({
    sessionId,
    baseDirectory: root,
    onTerminal: (event) => {
      terminal.resolve({
        phase: event.state?.phase ?? '',
        connection: event.state?.connection,
        code: event.code
      })
    }
  })
  Object.defineProperty(service, 'worker', {
    value: async (
      snapshot: ManagedSnapshot,
      _action: ManagedWorkerAction,
      _signal: AbortSignal,
      planId: string
    ) => ({
      receipt: {
        application_digest: nestJSPreviewApplicationDigest(snapshot.application),
        plan_digest: planId
      }
    })
  })
  const application = browserApplication()
  const config = {
    previewPort: 5193,
    apiPort,
    dbPort: 55449,
    audience: 'notes-api',
    jwksURL: 'https://127.0.0.1:18443/certs',
    caFile: ''
  }
  try {
    const prepared = await service.execute({
      version: 1,
      id: 'prepare',
      command: 'prepare',
      application,
      config
    })
    if (!prepared.plan) throw new Error('Expected initial plan')
    await service.execute({
      version: 1,
      id: 'setup',
      command: 'setup',
      planId: prepared.plan.planId
    })
    const session = join(root, sessionId)
    const digest = nestJSPreviewApplicationDigest(application)
    const dist = join(session, 'generations', digest, 'dist')
    mkdirSync(dist, { recursive: true })
    writeFileSync(
      join(dist, 'main.js'),
      `import {createServer} from 'node:http';createServer((req,res)=>{if(req.url==='/exit'){process.exit(17)}res.setHeader('content-type','application/json');res.end(${JSON.stringify(JSON.stringify({ version: 1, applicationId: application.applicationId, applicationDigest: digest }))})}).listen(Number(process.env.PORT),'127.0.0.1')`
    )
    writeFileSync(
      join(session, '.local/credentials.json'),
      JSON.stringify({
        version: 1,
        container: 'openpencil-notes-' + 'a'.repeat(16),
        volume: 'openpencil-notes-data-' + 'a'.repeat(16),
        admin: 'b'.repeat(64),
        runtime: 'c'.repeat(64)
      }),
      { mode: 0o600 }
    )
    writeFileSync(join(session, '.local/postgres-password'), 'b'.repeat(64) + '\n', { mode: 0o600 })
    const running = await service.execute({ version: 1, id: 'start', command: 'start' })
    expect(running.phase).toBe('running')
    await fetch(`http://127.0.0.1:${apiPort}/exit`).catch(() => undefined)
    expect(await terminal.promise).toEqual({
      phase: 'failed',
      connection: null,
      code: 'managed-api-exited'
    })
    await service.execute({ version: 1, id: 'close', command: 'close' })
    const directory = new ManagedPreviewDirectory(sessionId, root)
    const worker = spawnManagedWorker(directory, digest, config, 'api')
    try {
      const deadline = Date.now() + 2000
      for (;;) {
        const response = await fetch(`http://127.0.0.1:${apiPort}/`).catch(() => null)
        if (response?.ok) break
        if (Date.now() >= deadline) throw new Error('Test API did not become ready')
        await Bun.sleep(20)
      }
      worker.child.stdin.end()
      const ended = await worker.completed
      expect(ended.code).not.toBe(0)
      expect(worker.child.signalCode !== null || worker.child.exitCode !== null).toBe(true)
      expect(await fetch(`http://127.0.0.1:${apiPort}/`).catch(() => null)).toBeNull()
    } finally {
      await worker.stop()
      directory.release()
    }
  } finally {
    await service.execute({ version: 1, id: 'cleanup', command: 'close' })
    rmSync(root, { recursive: true, force: true })
  }
})
