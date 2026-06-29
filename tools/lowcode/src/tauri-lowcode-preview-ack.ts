#!/usr/bin/env bun
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

interface Options {
  port: string
  selector: string
  screenshot: string
  skipScreenshot: boolean
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    port: '9223',
    selector: '#lowcode-preview',
    screenshot: 'test-results/tauri-mcp-screenshot.png',
    skipScreenshot: false
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
      printUsage()
      process.exit(0)
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  return options
}

function printUsage(): void {
  console.log(`Usage: bun run tauri:mcp:lowcode-preview-ack [options]

Verifies a running OpenPencil Tauri automation debug app through the Hypothesi
Tauri MCP bridge. Start the app first with:

  bun run tauri:automation:dev

Options:
  --port <port>              Tauri MCP bridge port. Default: 9223
  --selector <selector>      Lowcode preview selector. Default: #lowcode-preview
  --screenshot <path>        Screenshot output path. Default: test-results/tauri-mcp-screenshot.png
  --skip-screenshot          Run all checks except screenshot capture
`)
}

function commandText(command: string[]): string {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')
}

function run(command: string[]): string {
  const proc = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
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

function runTauriMcp(args: string[]): string {
  const bin = Bun.env.TAURI_MCP_BIN
  if (bin) return run([bin, ...args])
  try {
    return run(['tauri-mcp', ...args])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/ENOENT|not found|No such file/i.test(message)) throw error
    return run(['bunx', 'tauri-mcp', ...args])
  }
}

function parseJson<T>(label: string, output: string): T {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end < start) throw new Error(`${label} did not return JSON:\n${output}`)
  return JSON.parse(output.slice(start, end + 1)) as T
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function logStep(message: string): void {
  console.log(`OK ${message}`)
}

function main(): void {
  const options = parseArgs(Bun.argv.slice(2))

  console.log(`OpenPencil Tauri lowcode preview ACK (port ${options.port})`)

  runTauriMcp(['driver-session', 'start', '--port', options.port])

  const status = parseJson<{ connected?: boolean; identifier?: string; port?: number }>(
    'driver-session status',
    runTauriMcp(['driver-session', 'status'])
  )
  assert(status.connected, 'Tauri MCP driver session is not connected.')
  assert(
    status.identifier === 'net.dannote.open-pencil',
    `Unexpected app identifier: ${status.identifier}`
  )
  logStep(`driver session connected to ${status.identifier} on ${status.port}`)

  const backend = parseJson<{
    app?: { name?: string; version?: string }
    environment?: { debug?: boolean; os?: string }
    tauri?: { version?: string }
    window_count?: number
  }>('ipc-get-backend-state', runTauriMcp(['ipc-get-backend-state']))
  assert(backend.app?.name === 'OpenPencil', `Unexpected Tauri app: ${backend.app?.name}`)
  assert(backend.environment?.debug, 'Expected a debug Tauri automation build.')
  assert((backend.window_count ?? 0) > 0, 'Expected at least one Tauri window.')
  logStep(`backend state: ${backend.app.name} ${backend.app.version} on ${backend.environment.os}`)

  const windows = parseJson<{
    windows?: Array<{ label?: string; url?: string; visible?: boolean }>
  }>('manage-window list', runTauriMcp(['manage-window', '--action', 'list']))
  const mainWindow = windows.windows?.find((window) => window.label === 'main')
  assert(mainWindow?.visible, 'Main Tauri window is not visible.')
  assert(
    mainWindow.url?.startsWith('http://localhost:'),
    `Unexpected main window URL: ${mainWindow.url}`
  )
  logStep(`main window visible at ${mainWindow.url}`)

  const domSnapshot = runTauriMcp(['webview-dom-snapshot', '--type', 'structure'])
  assert(
    domSnapshot.includes(options.selector),
    `DOM snapshot does not include ${options.selector}.`
  )
  logStep(`${options.selector} present in webview DOM snapshot`)

  const probeScript = `(() => ({ hasTauri: Boolean(window.__TAURI__), hasLowcodePreview: Boolean(document.querySelector('${options.selector}')), toolbarText: document.querySelector('${options.selector}')?.textContent?.slice(0, 200) ?? null }))()`
  const probe = parseJson<{
    hasTauri?: boolean
    hasLowcodePreview?: boolean
    toolbarText?: string | null
  }>('webview-execute-js', runTauriMcp(['webview-execute-js', '--script', probeScript]))
  assert(probe.hasTauri, 'window.__TAURI__ is not available in the webview.')
  assert(probe.hasLowcodePreview, `${options.selector} was not found by webview JS.`)
  assert(
    probe.toolbarText?.includes('Preview'),
    `Unexpected preview toolbar text: ${probe.toolbarText}`
  )
  logStep('webview JS can see window.__TAURI__ and lowcode preview toolbar')

  const styles = parseJson<Record<string, string>>(
    'webview-get-styles',
    runTauriMcp([
      'webview-get-styles',
      '--selector',
      options.selector,
      '--properties',
      'display,visibility,width,height'
    ])
  )
  assert(
    styles.display && styles.display !== 'none',
    `${options.selector} display is ${styles.display}`
  )
  assert(styles.visibility !== 'hidden', `${options.selector} visibility is hidden`)
  assert(styles.width !== '0px' && styles.height !== '0px', `${options.selector} has zero size`)
  logStep(`${options.selector} is visible (${styles.display}, ${styles.width} x ${styles.height})`)

  const waitOutput = runTauriMcp([
    'webview-wait-for',
    '--type',
    'selector',
    '--value',
    options.selector,
    '--timeout',
    '5000'
  ])
  assert(waitOutput.includes('Element found'), `Selector wait failed:\n${waitOutput}`)
  logStep(`selector wait found ${options.selector}`)

  if (!options.skipScreenshot) {
    const screenshotPath = resolve(options.screenshot)
    mkdirSync(dirname(screenshotPath), { recursive: true })
    const screenshotOutput = runTauriMcp(['webview-screenshot', '--file', screenshotPath])
    assert(
      screenshotOutput.includes('Wrote image'),
      `Screenshot did not report a written file:\n${screenshotOutput}`
    )
    logStep(`screenshot written to ${screenshotPath}`)
  }

  console.log('Tauri lowcode preview ACK passed.')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? `Error: ${error.message}` : String(error))
  process.exit(1)
}
