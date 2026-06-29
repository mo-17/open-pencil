import { describe, expect, test } from 'bun:test'

import type { AckDeps, SpawnOutput } from '#tools/lowcode/src/tauri-lowcode-preview-ack'
import { commandText, parseArgs, runCli } from '#tools/lowcode/src/tauri-lowcode-preview-ack'

function output(stdout = '', stderr = '', success = true): SpawnOutput {
  return {
    success,
    stdout: { toString: () => stdout },
    stderr: { toString: () => stderr }
  }
}

function keyFor(command: string[]): string {
  const args = command[0] === 'bunx' ? command.slice(2) : command.slice(1)
  if (args[0] === 'webview-execute-js') return 'webview-execute-js'
  return args.join(' ')
}

function makeDeps(options: {
  env?: Record<string, string | undefined>
  missingLocalBin?: boolean
  responses?: Record<string, string>
}): AckDeps & { commands: string[][]; errors: string[]; logs: string[]; mkdirs: string[] } {
  const commands: string[][] = []
  const errors: string[] = []
  const logs: string[] = []
  const mkdirs: string[] = []
  const responses: Record<string, string> = {
    'driver-session start --port 9223': '',
    'driver-session status': JSON.stringify({
      connected: true,
      identifier: 'net.dannote.open-pencil',
      port: 9223
    }),
    'ipc-get-backend-state': JSON.stringify({
      app: { name: 'OpenPencil', version: '0.13.2' },
      environment: { debug: true, os: 'macos' },
      tauri: { version: '2.10.2' },
      window_count: 1
    }),
    'manage-window --action list': JSON.stringify({
      windows: [{ label: 'main', url: 'http://localhost:1420/', visible: true }]
    }),
    'webview-dom-snapshot --type structure': '<main>#lowcode-preview</main>',
    'webview-execute-js': JSON.stringify({
      hasTauri: true,
      hasLowcodePreview: true,
      toolbarText: 'Preview UI Tailwind shadcn Theme Light Dark'
    }),
    'webview-get-styles --selector #lowcode-preview --properties display,visibility,width,height':
      JSON.stringify({ display: 'flex', visibility: 'visible', width: '320px', height: '240px' }),
    'webview-wait-for --type selector --value #lowcode-preview --timeout 5000': 'Element found',
    ...options.responses
  }

  return {
    commands,
    errors,
    logs,
    mkdirs,
    env: options.env ?? {},
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    mkdirSync: (path) => {
      mkdirs.push(path)
    },
    spawnSync: (command) => {
      commands.push(command)
      if (options.missingLocalBin && command[0] === 'tauri-mcp') {
        return output('', 'ENOENT: tauri-mcp not found', false)
      }
      const response = responses[keyFor(command)]
      if (response === undefined)
        return output('', `Unexpected command: ${commandText(command)}`, false)
      return output(response)
    }
  }
}

describe('Tauri lowcode preview ACK helper', () => {
  test('parses defaults and help without running bridge commands', () => {
    expect(parseArgs([])).toEqual({
      port: '9223',
      selector: '#lowcode-preview',
      screenshot: 'test-results/tauri-mcp-screenshot.png',
      skipScreenshot: false,
      help: false
    })

    const deps = makeDeps({})
    expect(runCli(['--help'], deps)).toBe(0)
    expect(deps.commands).toHaveLength(0)
    expect(deps.logs[0]).toContain('Usage: bun run tauri:mcp:lowcode-preview-ack')
  })

  test('falls back to bunx tauri-mcp and can skip screenshots', () => {
    const deps = makeDeps({ missingLocalBin: true })

    expect(runCli(['--skip-screenshot'], deps)).toBe(0)

    expect(deps.commands.some((command) => command[0] === 'tauri-mcp')).toBe(true)
    expect(deps.commands.some((command) => commandText(command).startsWith('bunx tauri-mcp'))).toBe(
      true
    )
    expect(deps.commands.some((command) => command.includes('webview-screenshot'))).toBe(false)
    expect(deps.logs.at(-1)).toBe('Tauri lowcode preview ACK passed.')
  })

  test('uses TAURI_MCP_BIN and creates the screenshot parent directory', () => {
    const deps = makeDeps({
      env: { TAURI_MCP_BIN: '/tmp/tauri mcp' },
      responses: {
        'webview-screenshot --file /private/tmp/open-pencil/ack.png':
          'Wrote image to /private/tmp/open-pencil/ack.png'
      }
    })

    expect(runCli(['--screenshot', '/private/tmp/open-pencil/ack.png'], deps)).toBe(0)

    expect(deps.commands.every((command) => command[0] === '/tmp/tauri mcp')).toBe(true)
    expect(deps.mkdirs).toEqual(['/private/tmp/open-pencil'])
    expect(deps.commands.at(-1)).toEqual([
      '/tmp/tauri mcp',
      'webview-screenshot',
      '--file',
      '/private/tmp/open-pencil/ack.png'
    ])
  })

  test('prints a concise error when the driver session is disconnected', () => {
    const deps = makeDeps({
      responses: {
        'driver-session status': JSON.stringify({
          connected: false,
          identifier: 'net.dannote.open-pencil',
          port: 9223
        })
      }
    })

    expect(runCli([], deps)).toBe(1)
    expect(deps.errors).toEqual(['Error: Tauri MCP driver session is not connected.'])
  })
})
