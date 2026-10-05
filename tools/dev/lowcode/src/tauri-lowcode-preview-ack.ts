#!/usr/bin/env bun
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface Options {
  port: string
  selector: string
  screenshot: string
  skipScreenshot: boolean
  help: boolean
}

export interface SpawnOutput {
  success: boolean
  stdout: { toString(): string }
  stderr: { toString(): string }
}

export interface AckDeps {
  env: Record<string, string | undefined>
  log: (message: string) => void
  error: (message: string) => void
  mkdirSync: (path: string, options: { recursive: true }) => void
  spawnSync: (command: string[]) => SpawnOutput
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    port: '9223',
    selector: '#lowcode-preview',
    screenshot: 'test-results/tauri-mcp-screenshot.png',
    skipScreenshot: false,
    help: false
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--port' && next) {
      options.port = next
      i += 1
    } else if (arg === '--selector' && next) {
      options.selector = next
      i += 1
    } else if (arg === '--screenshot' && next) {
      options.screenshot = next
      i += 1
    } else if (arg === '--skip-screenshot') {
      options.skipScreenshot = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  return options
}

function defaultDeps(): AckDeps {
  return {
    env: Bun.env,
    log: (message) => console.log(message),
    error: (message) => console.error(message),
    mkdirSync,
    spawnSync: (command) => Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
  }
}

export function usageText(): string {
  return `Usage: bun run tauri:mcp:lowcode-preview-ack [options]

Verifies a running OpenPencil Tauri automation debug app through the Hypothesi
Tauri MCP bridge. Start the app first with:

  bun run tauri:automation:dev

Options:
  --port <port>              Tauri MCP bridge port. Default: 9223
  --selector <selector>      Lowcode preview selector. Default: #lowcode-preview
  --screenshot <path>        Screenshot output path. Default: test-results/tauri-mcp-screenshot.png
  --skip-screenshot          Run all checks except screenshot capture
`
}

export function commandText(command: string[]): string {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')
}

function run(command: string[], deps: AckDeps): string {
  const proc = deps.spawnSync(command)
  const stdout = proc.stdout.toString()
  const stderr = proc.stderr.toString()
  if (!proc.success) {
    throw new Error(
      [
        `$ ${commandText(command)}`,
        stdout.trim(),
        stderr.trim(),
        '',
        'Make sure `bun run tauri:automation:dev` is running and the Tauri MCP bridge is listening.'
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
  return stdout.trim()
}

function runTauriMCP(args: string[], deps: AckDeps): string {
  const bin = deps.env.TAURI_MCP_BIN
  if (bin) return run([bin, ...args], deps)
  try {
    return run(['tauri-mcp', ...args], deps)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/ENOENT|not found|No such file/i.test(message)) throw error
    return run(['bunx', 'tauri-mcp', ...args], deps)
  }
}

function parseJSON<T>(label: string, output: string): T {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end < start) throw new Error(`${label} did not return JSON:\n${output}`)
  return JSON.parse(output.slice(start, end + 1)) as T
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function logStep(message: string, deps: AckDeps): void {
  deps.log(`OK ${message}`)
}

function readElementStyles(selector: string, deps: AckDeps): Record<string, string> {
  try {
    return parseJSON<Record<string, string>>(
      'webview-get-styles',
      runTauriMCP(
        [
          'webview-get-styles',
          '--selector',
          selector,
          '--properties',
          'display,visibility,width,height'
        ],
        deps
      )
    )
  } catch {
    const styleScript = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { display: 'none', visibility: 'hidden', width: '0px', height: '0px' }; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return { display: s.display, visibility: s.visibility, width: s.width || String(r.width) + 'px', height: s.height || String(r.height) + 'px' }; })()`
    return parseJSON<Record<string, string>>(
      'webview-execute-js styles fallback',
      runTauriMCP(['webview-execute-js', '--script', styleScript], deps)
    )
  }
}

function waitForSelector(selector: string, deps: AckDeps): void {
  try {
    const waitOutput = runTauriMCP(
      ['webview-wait-for', '--type', 'selector', '--value', selector, '--timeout', '5000'],
      deps
    )
    assert(waitOutput.includes('Element found'), `Selector wait failed:\n${waitOutput}`)
  } catch {
    const waitScript = `(() => ({ found: Boolean(document.querySelector(${JSON.stringify(selector)})) }))()`
    const fallback = parseJSON<{ found?: boolean }>(
      'webview-execute-js selector wait fallback',
      runTauriMCP(['webview-execute-js', '--script', waitScript], deps)
    )
    assert(fallback.found, `Selector wait failed: ${selector} was not found.`)
  }
}

export function runAck(options: Options, deps: AckDeps = defaultDeps()): void {
  deps.log(`OpenPencil Tauri lowcode preview ACK (port ${options.port})`)

  runTauriMCP(['driver-session', 'start', '--port', options.port], deps)

  const status = parseJSON<{ connected?: boolean; identifier?: string; port?: number }>(
    'driver-session status',
    runTauriMCP(['driver-session', 'status'], deps)
  )
  assert(status.connected, 'Tauri MCP driver session is not connected.')
  assert(
    status.identifier === 'net.dannote.open-pencil',
    `Unexpected app identifier: ${status.identifier}`
  )
  logStep(`driver session connected to ${status.identifier} on ${status.port}`, deps)

  const backend = parseJSON<{
    app?: { name?: string; version?: string }
    environment?: { debug?: boolean; os?: string }
    tauri?: { version?: string }
    window_count?: number
  }>('ipc-get-backend-state', runTauriMCP(['ipc-get-backend-state'], deps))
  assert(backend.app?.name === 'OpenPencil', `Unexpected Tauri app: ${backend.app?.name}`)
  assert(backend.environment?.debug, 'Expected a debug Tauri automation build.')
  assert((backend.window_count ?? 0) > 0, 'Expected at least one Tauri window.')
  logStep(
    `backend state: ${backend.app.name} ${backend.app.version} on ${backend.environment.os}`,
    deps
  )

  const windows = parseJSON<{
    windows?: Array<{ label?: string; url?: string; visible?: boolean }>
  }>('manage-window list', runTauriMCP(['manage-window', '--action', 'list'], deps))
  const mainWindow = windows.windows?.find((window) => window.label === 'main')
  assert(mainWindow?.visible, 'Main Tauri window is not visible.')
  assert(
    mainWindow.url?.startsWith('http://localhost:'),
    `Unexpected main window URL: ${mainWindow.url}`
  )
  logStep(`main window visible at ${mainWindow.url}`, deps)

  const domSnapshot = runTauriMCP(['webview-dom-snapshot', '--type', 'structure'], deps)
  assert(
    domSnapshot.includes(options.selector),
    `DOM snapshot does not include ${options.selector}.`
  )
  logStep(`${options.selector} present in webview DOM snapshot`, deps)

  const probeScript = `(() => ({ hasTauri: Boolean(window.__TAURI__), hasLowcodePreview: Boolean(document.querySelector('${options.selector}')), toolbarText: document.querySelector('${options.selector}')?.textContent?.slice(0, 200) ?? null }))()`
  const probe = parseJSON<{
    hasTauri?: boolean
    hasLowcodePreview?: boolean
    toolbarText?: string | null
  }>('webview-execute-js', runTauriMCP(['webview-execute-js', '--script', probeScript], deps))
  assert(probe.hasTauri, 'window.__TAURI__ is not available in the webview.')
  assert(probe.hasLowcodePreview, `${options.selector} was not found by webview JS.`)
  assert(
    probe.toolbarText?.includes('Preview'),
    `Unexpected preview toolbar text: ${probe.toolbarText}`
  )
  logStep('webview JS can see window.__TAURI__ and lowcode preview toolbar', deps)

  const styles = readElementStyles(options.selector, deps)
  assert(
    styles.display && styles.display !== 'none',
    `${options.selector} display is ${styles.display}`
  )
  assert(styles.visibility !== 'hidden', `${options.selector} visibility is hidden`)
  assert(styles.width !== '0px' && styles.height !== '0px', `${options.selector} has zero size`)
  logStep(
    `${options.selector} is visible (${styles.display}, ${styles.width} x ${styles.height})`,
    deps
  )

  waitForSelector(options.selector, deps)
  logStep(`selector wait found ${options.selector}`, deps)

  if (!options.skipScreenshot) {
    const screenshotPath = resolve(options.screenshot)
    deps.mkdirSync(dirname(screenshotPath), { recursive: true })
    const screenshotOutput = runTauriMCP(['webview-screenshot', '--file', screenshotPath], deps)
    assert(
      screenshotOutput.includes('Wrote image'),
      `Screenshot did not report a written file:\n${screenshotOutput}`
    )
    logStep(`screenshot written to ${screenshotPath}`, deps)
  }

  deps.log('Tauri lowcode preview ACK passed.')
}

export function runCLI(argv: string[] = Bun.argv.slice(2), deps: AckDeps = defaultDeps()): number {
  try {
    const options = parseArgs(argv)
    if (options.help) {
      deps.log(usageText())
      return 0
    }
    runAck(options, deps)
    return 0
  } catch (error) {
    deps.error(error instanceof Error ? `Error: ${error.message}` : String(error))
    return 1
  }
}

if (import.meta.main) {
  process.exit(runCLI())
}
