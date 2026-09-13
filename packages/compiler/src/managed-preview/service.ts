import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'

import { nestJSPreviewApplicationDigest } from '../backend/nestjs/preview-digest'
import type { PreviewLocalBackendConnection } from '../local-backend-preview/connection'
import { createLocalBackendPreviewGuard } from '../local-backend-preview/server'
import { ManagedPreviewDirectory } from './directory'
import {
  compileManagedGeneration,
  rawDigest,
  verifyManagedGeneration,
  writeManagedGeneration
} from './generation'
import { managedPlan, type ManagedSnapshot } from './plan'
import {
  runManagedWorker,
  spawnManagedWorker,
  type ManagedChild,
  type ManagedWorkerAction
} from './process'
import type {
  ManagedPreviewCommand,
  ManagedPreviewEvent,
  ManagedPreviewPhase,
  ManagedPreviewPlan,
  ManagedPreviewState
} from './protocol'
import { managedSchema } from './schema'
import {
  initialSQL,
  loadPending,
  loadSnapshot,
  removePending,
  validateCertificate,
  writeConfiguration,
  type ManagedPending
} from './storage'

export interface ManagedPreviewServiceOptions {
  readonly sessionId: string
  /** Test/library injection only. The CLI never accepts an output path. */
  readonly baseDirectory?: string
  readonly onProgress?: (event: Extract<ManagedPreviewEvent, { type: 'progress' }>) => void
  readonly onTerminal?: (event: Extract<ManagedPreviewEvent, { type: 'error' }>) => void
}
function receipt(value: unknown): { applicationDigest: string; planId: string } {
  if (
    !value ||
    typeof value !== 'object' ||
    !('receipt' in value) ||
    !value.receipt ||
    typeof value.receipt !== 'object'
  )
    throw new Error('Managed database receipt is missing.')
  const row = value.receipt
  if (
    !('application_digest' in row) ||
    !('plan_digest' in row) ||
    typeof row.application_digest !== 'string' ||
    typeof row.plan_digest !== 'string'
  )
    throw new Error('Managed database receipt is invalid.')
  return { applicationDigest: row.application_digest, planId: row.plan_digest }
}
async function available(port: number): Promise<void> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', () =>
      reject(new Error('The managed API port is occupied. No existing process was stopped.'))
    )
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()))
  })
}
export class ManagedPreviewService {
  private readonly directory: ManagedPreviewDirectory
  private current: ManagedSnapshot | null
  private candidate: ManagedSnapshot | null
  private pending: ManagedPending | null
  private plan: ManagedPreviewPlan | null = null
  private phase: ManagedPreviewPhase = 'empty'
  private api: ManagedChild | null = null
  private active: AbortController | null = null
  private operation: Promise<ManagedPreviewState> | null = null
  private stopping: Promise<ManagedPreviewState> | null = null
  private closed = false
  private activeId = ''
  private constructor(private readonly options: ManagedPreviewServiceOptions) {
    this.directory = new ManagedPreviewDirectory(options.sessionId, options.baseDirectory)
    try {
      this.current = loadSnapshot(this.directory, 'current.json')
      this.candidate = loadSnapshot(this.directory, 'candidate.json')
      this.pending = loadPending(this.directory)
      for (const snapshot of [this.current, this.candidate, this.pending?.to])
        if (snapshot) this.directory.bind(snapshot.application.applicationId)
    } catch (error) {
      this.directory.release()
      throw error
    }
  }
  static async create(options: ManagedPreviewServiceOptions): Promise<ManagedPreviewService> {
    const service = new ManagedPreviewService(options)
    try {
      if (service.pending) service.candidate = service.pending.to
      if (service.candidate)
        service.plan = await managedPlan(
          service.pending ? service.pending.from : service.current,
          service.candidate
        )
      service.phase = 'empty'
      if (service.current) service.phase = 'stopped'
      if (service.candidate) service.phase = 'prepared'
      if (service.plan?.kind === 'blocked') service.phase = 'blocked'
      return service
    } catch (error) {
      service.directory.release()
      throw error
    }
  }
  status(): ManagedPreviewState {
    return {
      sessionId: this.options.sessionId,
      phase: this.phase,
      initialized: this.current !== null,
      applicationId:
        this.current?.application.applicationId ??
        this.candidate?.application.applicationId ??
        null,
      applicationDigest: this.current
        ? nestJSPreviewApplicationDigest(this.current.application)
        : null,
      connection: this.phase === 'running' && this.current ? this.connection(this.current) : null,
      plan: this.plan
    }
  }
  private connection(snapshot: ManagedSnapshot): PreviewLocalBackendConnection {
    const base = snapshot.application.httpApi?.browserClient?.apiBasePath
    if (!base) throw new Error('Managed preview browser API configuration is missing.')
    return {
      previewPort: snapshot.config.previewPort,
      apiPort: snapshot.config.apiPort,
      apiBasePath: base,
      applicationId: snapshot.application.applicationId,
      applicationDigest: nestJSPreviewApplicationDigest(snapshot.application)
    }
  }
  private progress(phase: ManagedPreviewPhase, message: string): void {
    this.phase = phase
    this.options.onProgress?.({ version: 1, type: 'progress', id: this.activeId, phase, message })
  }
  async execute(command: ManagedPreviewCommand): Promise<ManagedPreviewState> {
    if (command.command === 'status') return this.status()
    if (command.command === 'stop') return this.stop()
    if (command.command === 'close') {
      this.closed = true
      try {
        return await this.stop()
      } finally {
        this.directory.release()
      }
    }
    if (this.closed || this.operation || this.stopping)
      throw new Error(
        'Managed preview is busy or closed. Wait for the current operation to finish.'
      )
    const controller = new AbortController()
    this.active = controller
    this.activeId = command.id
    const work = this.perform(command, controller.signal).catch((error: unknown) => {
      this.phase = controller.signal.aborted ? 'stopped' : 'failed'
      throw error
    })
    this.operation = work
    try {
      return await work
    } finally {
      if (this.operation === work) {
        this.operation = null
        this.active = null
      }
    }
  }
  private async perform(
    command: Exclude<ManagedPreviewCommand, { command: 'stop' | 'status' | 'close' }>,
    signal: AbortSignal
  ): Promise<ManagedPreviewState> {
    if (command.command === 'prepare') {
      await this.prepare({ application: command.application, config: command.config }, signal)
    } else if (command.command === 'setup' || command.command === 'apply') {
      await this.apply(command.command, command.planId, signal)
    } else await this.start(signal)
    return this.status()
  }
  private async prepare(snapshot: ManagedSnapshot, signal: AbortSignal): Promise<void> {
    this.directory.bind(snapshot.application.applicationId)
    validateCertificate(snapshot.config.caFile)
    const from = this.pending ? this.pending.from : this.current
    const nextPlan = await managedPlan(from, snapshot)
    signal.throwIfAborted()
    if (this.pending && this.pending.planId !== nextPlan.planId)
      throw new Error(
        'A previously approved migration is pending recovery. Resume its exact plan before preparing different changes.'
      )
    if (!this.current || JSON.stringify(this.current) !== JSON.stringify(snapshot))
      await this.stopAPI()
    signal.throwIfAborted()
    writeManagedGeneration(this.directory, snapshot.application, initialSQL(this.directory))
    this.candidate = snapshot
    this.plan = nextPlan
    this.directory.json('candidate.json', snapshot)
    this.phase = nextPlan.kind === 'blocked' ? 'blocked' : 'prepared'
  }
  private async worker(
    snapshot: ManagedSnapshot,
    action: ManagedWorkerAction,
    signal: AbortSignal,
    planId = ''
  ): Promise<unknown> {
    return runManagedWorker(
      this.directory,
      nestJSPreviewApplicationDigest(snapshot.application),
      snapshot.config,
      action,
      signal,
      planId
    )
  }
  private writeOperation(pending: ManagedPending, plan: ManagedPreviewPlan): void {
    const sql = initialSQL(this.directory)
    if (!sql) throw new Error('Managed initial schema baseline is missing.')
    this.directory.json('.local/managed-operation.json', {
      version: 1,
      planId: plan.planId,
      fromApplicationDigest: plan.fromApplicationDigest,
      toApplicationDigest: plan.toApplicationDigest,
      sql: plan.kind === 'initial' ? '' : plan.sql,
      sqlDigest: rawDigest(plan.kind === 'initial' ? '' : plan.sql),
      initialDigest: createHash('sha256').update(sql).digest('hex'),
      fromSchema: pending.from ? managedSchema(pending.from.application) : null,
      toSchema: managedSchema(pending.to.application)
    })
    writeConfiguration(this.directory, pending.to)
  }
  private async apply(
    action: 'setup' | 'apply',
    planId: string,
    signal: AbortSignal
  ): Promise<void> {
    if (
      !this.candidate ||
      !this.plan ||
      this.plan.planId !== planId ||
      this.plan.kind === 'blocked'
    )
      throw new Error('Review and approve the current managed preview plan.')
    const from = this.pending ? this.pending.from : this.current
    const fresh = await managedPlan(from, this.candidate)
    if (fresh.planId !== planId || (action === 'setup') !== (fresh.kind === 'initial'))
      throw new Error(
        'The approved managed preview plan is stale or requires a different operation.'
      )
    signal.throwIfAborted()
    await this.stopAPI()
    signal.throwIfAborted()
    if (action === 'setup') {
      this.progress(
        'installing',
        'Installing the pinned backend dependencies. Database initialization has not started.'
      )
      await this.worker(this.candidate, 'install', signal)
    }
    this.progress(
      'building',
      'Building the generated NestJS backend before applying any database change.'
    )
    verifyManagedGeneration(this.directory, this.candidate.application, initialSQL(this.directory))
    await this.worker(this.candidate, 'build', signal)
    signal.throwIfAborted()
    if (!initialSQL(this.directory)) {
      const sql = compileManagedGeneration(this.candidate.application).get(
        'migrations/001-initial.sql'
      )
      if (!sql) throw new Error('Initial migration is missing.')
      this.directory.write('initial.sql', sql)
    }
    const pending: ManagedPending = this.pending ?? { from, to: this.candidate, planId }
    this.directory.json('pending.json', pending)
    this.pending = pending
    this.writeOperation(pending, fresh)
    this.progress(
      'migrating',
      action === 'setup'
        ? 'Initializing the reviewed schema in this isolated database.'
        : 'Verifying the live schema and applying the reviewed migration transaction.'
    )
    const applied = receipt(await this.worker(this.candidate, action, signal, planId))
    if (applied.applicationDigest !== fresh.toApplicationDigest || applied.planId !== fresh.planId)
      throw new Error('Managed database receipt did not confirm the approved plan.')
    signal.throwIfAborted()
    this.commitPending()
    this.phase = 'stopped'
  }
  private commitPending(): void {
    if (!this.pending) return
    this.directory.json('current.json', this.pending.to)
    this.current = this.pending.to
    removePending(this.directory)
    this.pending = null
    this.plan = null
    this.candidate = null
    this.directory.json('candidate.json', this.current)
  }
  private async recover(signal: AbortSignal): Promise<void> {
    const pending = this.pending
    if (!pending) return
    const plan = await managedPlan(pending.from, pending.to)
    if (plan.planId !== pending.planId)
      throw new Error('Pending managed migration no longer matches the reviewed plan.')
    this.writeOperation(pending, plan)
    const applied = receipt(await this.worker(pending.to, 'verify', signal, plan.planId))
    if (applied.applicationDigest !== plan.toApplicationDigest || applied.planId !== plan.planId)
      throw new Error(
        'The pending migration did not commit. Reapply the previously approved plan explicitly.'
      )
    signal.throwIfAborted()
    this.commitPending()
  }
  private async start(signal: AbortSignal): Promise<void> {
    await this.stopAPI()
    await this.recover(signal)
    const current = this.current
    if (!current) throw new Error('Review and initialize this managed preview first.')
    signal.throwIfAborted()
    verifyManagedGeneration(this.directory, current.application, initialSQL(this.directory))
    if (
      !existsSync(
        this.directory.path(
          `generations/${nestJSPreviewApplicationDigest(current.application)}/dist/main.js`
        )
      )
    )
      throw new Error(
        'The managed backend build is missing. Prepare and rebuild it before starting.'
      )
    writeConfiguration(this.directory, current)
    const planId = nestJSPreviewApplicationDigest(current.application)
    this.directory.json('.local/managed-operation.json', {
      planId,
      toSchema: managedSchema(current.application)
    })
    const verified = receipt(await this.worker(current, 'verify', signal, planId))
    if (verified.applicationDigest !== planId)
      throw new Error('Managed database and application identities differ.')
    await available(current.config.apiPort)
    signal.throwIfAborted()
    this.progress(
      'starting',
      'Starting the owned API and checking its loopback application contract.'
    )
    const api = spawnManagedWorker(this.directory, planId, current.config, 'api')
    this.api = api
    const connection = this.connection(current)
    const deadline = Date.now() + 20_000
    try {
      for (;;) {
        signal.throwIfAborted()
        if (api.child.exitCode !== null || api.child.signalCode !== null)
          throw new Error(
            'Managed API exited before readiness. Check the configured identity service and trusted CA.'
          )
        try {
          await createLocalBackendPreviewGuard(connection).check()
          break
        } catch {
          if (Date.now() >= deadline)
            throw new Error(
              'Managed API readiness timed out. Check Node, database and identity configuration.'
            )
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 100)
        })
      }
      signal.throwIfAborted()
      this.phase = 'running'
      void api.completed.then(() => {
        if (this.api === api) {
          this.api = null
          this.phase = 'failed'
          this.options.onTerminal?.({
            version: 1,
            type: 'error',
            id: null,
            code: 'managed-api-exited',
            message: 'Managed API exited unexpectedly. This preview must be restarted.',
            state: this.status()
          })
        }
        return undefined
      })
    } catch (error) {
      await this.stopAPI()
      throw error
    }
  }
  private async stopAPI(): Promise<void> {
    const api = this.api
    this.api = null
    await api?.stop()
  }
  stop(): Promise<ManagedPreviewState> {
    if (this.stopping) return this.stopping
    this.active?.abort()
    const work = (async () => {
      await this.stopAPI()
      await this.operation?.catch(() => undefined)
      const snapshot = this.pending?.to ?? this.current ?? this.candidate
      if (snapshot) await this.worker(snapshot, 'stop', new AbortController().signal)
      this.phase = 'stopped'
      return this.status()
    })()
    this.stopping = work
    void work
      .finally(() => {
        if (this.stopping === work) this.stopping = null
      })
      .catch(() => undefined)
    return work
  }
}
