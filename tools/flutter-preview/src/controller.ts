import {
  compileFlutterPreviewSnapshot,
  type FlutterPreviewCommand,
  type FlutterPreviewDevice,
  type FlutterPreviewEvent,
  type FlutterPreviewState,
  type FlutterPreviewSnapshot
} from '@open-pencil/compiler/flutter-preview'

import { prepareOfflineAndroid } from './android-offline'
import { validateOfflineDependencies } from './dependencies'
import { boundedText, checkSignal, FlutterPreviewError } from './errors'
import { FlutterMachine } from './machine'
import {
  OwnedFlutterProject,
  validateGeneratedFiles,
  type FlutterProject,
  type GeneratedFiles
} from './owned-project'
import {
  runFlutterCommand,
  spawnFlutterChild,
  type FlutterChild,
  type FlutterSpawn
} from './process'
import {
  createFlutterArguments,
  ensureFlutterEngineCache,
  FLUTTER_ARGUMENT_PREFIX,
  parseFlutterDevices,
  resolveFlutterSDK,
  runFlutterArguments,
  type FlutterSDK
} from './sdk'

interface ControllerOptions {
  onEvent(event: FlutterPreviewEvent): void
  spawn?: FlutterSpawn
  resolveSDK?: () => Promise<FlutterSDK>
  ensureCache?: (sdk: FlutterSDK, platform: FlutterPreviewDevice['platform']) => Promise<void>
  createProject?: () => Promise<FlutterProject>
  prepareAndroid?: (project: FlutterProject, sdk: FlutterSDK) => Promise<void>
  compile?: (snapshot: FlutterPreviewSnapshot) => ReturnType<typeof compileFlutterPreviewSnapshot>
  timeouts?: { commandMs?: number; startMs?: number; reloadMs?: number }
}

const emptyState = (): FlutterPreviewState => ({
  sessionId: null,
  phase: 'idle',
  deviceId: null,
  revision: null,
  projectDirectory: null
})

function equalFiles(left: GeneratedFiles, right: GeneratedFiles): boolean {
  return (
    left.size === right.size &&
    [...left].every(([path, content]) => {
      const other = right.get(path)
      return other !== undefined && Buffer.from(content).equals(Buffer.from(other))
    })
  )
}

function hotReloadCompatible(previous: GeneratedFiles, next: GeneratedFiles): boolean {
  return (
    previous.size === next.size &&
    [...previous].every(([path, content]) => {
      const changed = next.get(path)
      if (changed === undefined) return false
      return path.startsWith('lib/') || Buffer.from(content).equals(Buffer.from(changed))
    })
  )
}

function warningsForEvent(warnings: ReturnType<typeof compileFlutterPreviewSnapshot>['warnings']) {
  const result: Array<{ code: string; message: string; nodeId?: string }> = []
  let bytes = 0
  for (const warning of warnings) {
    const entry = {
      code: boundedText(warning.code, 256),
      message: boundedText(warning.message, 1_024),
      ...(warning.nodeId ? { nodeId: boundedText(warning.nodeId, 256) } : {})
    }
    bytes += Buffer.byteLength(JSON.stringify(entry))
    if (result.length >= 32 || bytes > 24 * 1024) break
    result.push(entry)
  }
  return result
}

export class FlutterPreviewController {
  private state = emptyState()
  private project: FlutterProject | null = null
  private files: GeneratedFiles | null = null
  private machine: FlutterMachine | null = null
  private readonly children = new Set<FlutterChild>()
  private operation: Promise<FlutterPreviewEvent> | null = null
  private abortController: AbortController | null = null
  private stopping: Promise<FlutterPreviewState> | null = null
  private closed = false
  private activeId: string | null = null
  private logId = 0

  constructor(private readonly options: ControllerOptions) {}

  getState(): FlutterPreviewState {
    return { ...this.state }
  }
  private event(event: FlutterPreviewEvent): void {
    this.options.onEvent(event)
  }
  private progress(phase: FlutterPreviewState['phase'], message: string): void {
    this.state.phase = phase
    this.event({ version: 1, type: 'progress', id: this.activeId, phase, message })
  }
  private child(sdk: FlutterSDK, args: readonly string[], cwd: string): FlutterChild {
    const child = (this.options.spawn ?? spawnFlutterChild)(sdk.executable, args, {
      cwd,
      environment: sdk.environment
    })
    this.children.add(child)
    void child.completed.then(() => this.children.delete(child))
    return child
  }
  private async command(
    sdk: FlutterSDK,
    args: readonly string[],
    signal: AbortSignal,
    label: string,
    cwd: string
  ): Promise<string> {
    checkSignal(signal)
    const child = this.child(sdk, args, cwd)
    const result = await runFlutterCommand(
      child,
      this.options.timeouts?.commandMs ?? 60_000,
      signal
    )
    if (this.project)
      await this.project.log(
        `${++this.logId}-${label}`,
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      )
    checkSignal(signal)
    if (result.code !== 0)
      throw new FlutterPreviewError(
        'flutter-preview-command-failed',
        `Flutter ${label} failed using the existing offline caches. Check the owned session logs.`
      )
    return result.stdout
  }
  private async devices(sdk: FlutterSDK, signal: AbortSignal): Promise<FlutterPreviewDevice[]> {
    const stdout = await this.command(
      sdk,
      [...FLUTTER_ARGUMENT_PREFIX, 'devices', '--machine'],
      signal,
      'devices',
      sdk.directory
    )
    return parseFlutterDevices(stdout)
  }

  execute(command: FlutterPreviewCommand): Promise<FlutterPreviewEvent> {
    if (command.command === 'stop' || command.command === 'close') {
      if (command.command === 'close') this.closed = true
      return this.stop().then((state) => ({ version: 1, type: 'result', id: command.id, state }))
    }
    if (this.closed || this.operation || this.stopping) {
      return Promise.reject(
        new FlutterPreviewError(
          'flutter-preview-busy',
          'Flutter preview is busy or closed. Wait for the active operation or stop it.'
        )
      )
    }
    const abortController = new AbortController()
    this.abortController = abortController
    this.activeId = command.id
    let timedOut = false
    let duration = this.options.timeouts?.commandMs ?? 60_000
    if (command.command === 'start') duration = this.options.timeouts?.startMs ?? 300_000
    else if (command.command === 'update') duration = this.options.timeouts?.reloadMs ?? 60_000
    const deadline = setTimeout(() => {
      timedOut = true
      abortController.abort()
    }, duration)
    const work = this.perform(command, abortController.signal).catch((error: unknown) => {
      if (!abortController.signal.aborted) this.state.phase = 'failed'
      if (timedOut)
        throw new FlutterPreviewError(
          'flutter-preview-timeout',
          'The native preview operation exceeded its total deadline.'
        )
      throw error
    })
    this.operation = work
    void work
      .finally(() => {
        clearTimeout(deadline)
        if (this.operation === work) {
          this.operation = null
          this.abortController = null
          this.activeId = null
        }
      })
      .catch(() => undefined)
    return work
  }

  private async perform(
    command: Exclude<FlutterPreviewCommand, { command: 'stop' | 'close' }>,
    signal: AbortSignal
  ): Promise<FlutterPreviewEvent> {
    if (command.command === 'devices') {
      const sdk = await (this.options.resolveSDK ?? resolveFlutterSDK)()
      checkSignal(signal)
      return {
        version: 1,
        type: 'result',
        id: command.id,
        state: this.getState(),
        devices: await this.devices(sdk, signal)
      }
    }
    const output = (this.options.compile ?? compileFlutterPreviewSnapshot)(command.snapshot)
    validateGeneratedFiles(output.files)
    validateOfflineDependencies(output.files)
    const warnings = warningsForEvent(output.warnings)
    checkSignal(signal)
    if (command.command === 'start') await this.start(command, output.files, signal)
    else await this.update(command.revision, output.files, signal)
    return { version: 1, type: 'result', id: command.id, state: this.getState(), warnings }
  }

  private async start(
    command: Extract<FlutterPreviewCommand, { command: 'start' }>,
    files: GeneratedFiles,
    signal: AbortSignal
  ): Promise<void> {
    if (this.machine)
      throw new FlutterPreviewError(
        'flutter-preview-already-running',
        'Stop the current native preview before starting another device.'
      )
    this.progress(
      'preparing',
      'Checking the existing Flutter SDK and already-running mobile emulators.'
    )
    const sdk = await (this.options.resolveSDK ?? resolveFlutterSDK)()
    checkSignal(signal)
    const devices = await this.devices(sdk, signal)
    const device = devices.find((item) => item.id === command.deviceId)
    if (!device)
      throw new FlutterPreviewError(
        'flutter-preview-device-unavailable',
        'Select an already-running iOS simulator or Android emulator reported by the local Flutter SDK. This preview does not boot devices.'
      )
    await (this.options.ensureCache ?? ensureFlutterEngineCache)(sdk, device.platform)
    checkSignal(signal)
    const project = await (this.options.createProject
      ? this.options.createProject()
      : OwnedFlutterProject.create())
    checkSignal(signal)
    this.project = project
    this.state = {
      sessionId: project.sessionId,
      phase: 'preparing',
      deviceId: device.id,
      revision: null,
      projectDirectory: project.directory
    }
    await this.command(
      sdk,
      createFlutterArguments(device.platform),
      signal,
      'create',
      project.directory
    )
    await project.write(files)
    if (device.platform === 'android')
      await (this.options.prepareAndroid ?? prepareOfflineAndroid)(project, sdk)
    checkSignal(signal)
    await this.command(
      sdk,
      [...FLUTTER_ARGUMENT_PREFIX, 'pub', 'get', '--offline'],
      signal,
      'pub-get-offline',
      project.directory
    )
    checkSignal(signal)
    const child = this.child(sdk, runFlutterArguments(device), project.directory)
    let stderr = ''
    const machine = new FlutterMachine(child, {
      deviceId: device.id,
      directory: project.directory,
      onLog: (message) => this.event({ version: 1, type: 'log', id: this.activeId, message }),
      onProgress: (message) =>
        this.event({
          version: 1,
          type: 'progress',
          id: this.activeId,
          phase: this.state.phase,
          message
        }),
      onStderr: (message) => {
        stderr = boundedText(`${stderr}\n${message}`, 65_536)
      },
      onExit: () => {
        if (this.machine !== machine || this.stopping || this.closed) return
        this.state.phase = 'failed'
        if (!this.operation)
          this.event({
            version: 1,
            type: 'error',
            id: null,
            code: 'flutter-preview-exited',
            message: 'The owned Flutter preview stopped unexpectedly.',
            state: this.getState()
          })
      }
    })
    this.machine = machine
    try {
      await machine.waitReady(this.options.timeouts?.startMs ?? 300_000, signal)
      checkSignal(signal)
      if (!machine.isRunning())
        throw new FlutterPreviewError(
          'flutter-preview-exited',
          'Flutter stopped before the start acknowledgement.'
        )
      this.files = files
      this.state.revision = command.revision
      this.state.phase = 'running'
    } catch (error) {
      if (this.machine === machine) this.machine = null
      await machine.stop()
      throw error
    } finally {
      await project.log(`${++this.logId}-run-stderr`, stderr)
    }
  }

  private async update(revision: number, next: GeneratedFiles, signal: AbortSignal): Promise<void> {
    const machine = this.machine
    const project = this.project
    const previous = this.files
    if (!machine || !project || !previous)
      throw new FlutterPreviewError(
        'flutter-preview-not-running',
        'Start a native Flutter preview before updating it.'
      )
    if (this.state.revision !== null && revision <= this.state.revision)
      throw new FlutterPreviewError(
        'flutter-preview-revision-stale',
        'Flutter preview refused an older or repeated revision.'
      )
    if (!hotReloadCompatible(previous, next))
      throw new FlutterPreviewError(
        'flutter-preview-restart-required',
        'Changing project dependencies, assets or generated file paths requires stopping and starting the native preview.'
      )
    this.progress(
      'reloading',
      'Generating Flutter source and requesting a state-preserving hot reload.'
    )
    let written = false
    try {
      await project.write(next, previous)
      written = true
      checkSignal(signal)
      if (!equalFiles(previous, next))
        await machine.reload(signal, this.options.timeouts?.reloadMs ?? 60_000)
      checkSignal(signal)
      if (!machine.isRunning())
        throw new FlutterPreviewError(
          'flutter-preview-exited',
          'Flutter stopped before the reload acknowledgement.'
        )
      this.files = next
      this.state.revision = revision
      this.state.phase = 'running'
    } catch (error) {
      if (!written) {
        await machine.stop()
        if (this.machine === machine) this.machine = null
        throw error
      }
      try {
        await project.write(previous, next)
      } catch {
        await machine.stop()
        if (this.machine === machine) this.machine = null
        throw new FlutterPreviewError(
          'flutter-preview-rollback-failed',
          'Hot reload failed and owned output could not be restored. The owned Flutter child was stopped.'
        )
      }
      throw error
    }
  }

  stop(): Promise<FlutterPreviewState> {
    if (this.stopping) return this.stopping
    this.abortController?.abort()
    this.progress('stopping', 'Stopping only the Flutter processes owned by this preview session.')
    const work = (async () => {
      const machine = this.machine
      this.machine = null
      await machine?.stop()
      await Promise.all([...this.children].map((child) => child.stop()))
      await this.operation?.catch(() => undefined)
      this.state.phase = 'idle'
      return this.getState()
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
