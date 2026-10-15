import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { resolveWorkspaceRoot } from '@open-pencil/package-artifacts-tools'

import { parseNativeLowcodeRequest, runNativeLowcodeCLI } from '../src/native-command'

const build = [
  '/tmp/document with spaces.fig',
  '-o',
  '/tmp/microfrontend output',
  '--target',
  'react',
  '--packaging',
  'microfrontend',
  '--app-id',
  'openpencil.sample',
  '--app-version',
  '1.2.3',
  '--package-name',
  '@demo/sample',
  '--base',
  './',
  '--json'
]
const deploy = [
  '/tmp/design.fig',
  '--provider',
  'netlify',
  '--environment',
  'preview',
  '--json',
  '--site',
  'review-site',
  '--ui-kit',
  'shadcn',
  '--i18n',
  '--locale',
  'en-US',
  '--locale',
  'zh-CN',
  '--backend-provider-stdin'
]
const credentialKeys = ['NETLIFY_AUTH_TOKEN', 'VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN']
const credentials = Object.fromEntries(credentialKeys.map((key) => [key, 'test-provider-value']))
const root = await resolveWorkspaceRoot(process.cwd())
const modulePath = join(root, 'tools/dev/lowcode/src/native-command.ts')

function childSource(mode: 'read' | 'wait'): string {
  return `
    import { runNativeLowcodeCLI } from ${JSON.stringify(modulePath)}
    await runNativeLowcodeCLI(process.argv.slice(1), {
      env: process.env,
      async run(request) {
        const credentialNames = ${JSON.stringify(credentialKeys)}.filter(name => process.env[name])
        ${
          mode === 'read'
            ? `
          let input = ''
          process.stdin.setEncoding('utf8')
          await new Promise(resolve => {
            process.stdin.on('data', chunk => { input += chunk })
            process.stdin.once('end', resolve)
          })
          process.stdout.write(JSON.stringify({ request, input, credentialNames }))
        `
            : `
          process.stdout.write('ready\\n')
          await new Promise(() => { setInterval(() => {}, 1000) })
        `
        }
      }
    })
  `
}

async function runChild(
  action: string,
  args: string[],
  input: string,
  mode: 'read' | 'wait' = 'read'
) {
  const child = Bun.spawn(
    [process.execPath, '--eval', childSource(mode), action, JSON.stringify(args)],
    {
      cwd: root,
      env: { ...process.env, ...credentials },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe'
    }
  )
  if (mode === 'read') {
    child.stdin.write(input)
    await child.stdin.flush()
    child.stdin.end()
  }
  return child
}

describe('fixed native lowcode CLI', () => {
  test('reconstructs microfrontend options and optional React UI kit', () => {
    expect(parseNativeLowcodeRequest(['build', JSON.stringify(build)])).toEqual({
      action: 'build',
      args: build
    })
    const shadcn = [...build, '--ui-kit', 'shadcn']
    expect(parseNativeLowcodeRequest(['build', JSON.stringify(shadcn)]).args).toEqual(shadcn)
    const vue = [...build]
    vue[4] = 'vue'
    expect(() =>
      parseNativeLowcodeRequest(['build', JSON.stringify([...vue, '--ui-kit', 'shadcn'])])
    ).toThrow()
  })

  test('preserves deployment i18n and Backend Provider stdin flags', () => {
    expect(parseNativeLowcodeRequest(['deploy', JSON.stringify(deploy)])).toEqual({
      action: 'deploy',
      args: deploy
    })
  })

  test('rejects a third action, extra flags, option-shaped paths and malformed envelopes', () => {
    for (const value of [
      ['eval', JSON.stringify(['--code', 'process.exit(0)'])],
      ['build', JSON.stringify([...build, '--help'])],
      ['deploy', JSON.stringify([...deploy, '--token', 'test-value'])],
      ['deploy', JSON.stringify(['--help', ...deploy.slice(1)])],
      ['build', '{}'],
      ['build', JSON.stringify(build), '--help'],
      ['deploy', JSON.stringify([...deploy, '--backend-provider-stdin'])]
    ])
      expect(() => parseNativeLowcodeRequest(value)).toThrow()
  })

  test('the pinned executable rejects a third action before loading a CLI command', async () => {
    const child = Bun.spawn(
      [process.execPath, join(root, 'tools/dev/lowcode/src/native-cli.ts'), 'eval', '[]'],
      {
        cwd: root,
        env: { ...process.env, ...credentials },
        stdout: 'pipe',
        stderr: 'pipe'
      }
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).not.toContain('test-provider-value')
  })

  test('removes ambient deployment credentials before loading a build command', async () => {
    const env: Record<string, string | undefined> = { ...credentials, PATH: '/test/runtime' }
    await runNativeLowcodeCLI(['build', JSON.stringify(build)], {
      env,
      async run(request) {
        expect(request.action).toBe('build')
        expect(credentialKeys.filter((name) => env[name])).toEqual([])
        expect(env.PATH).toBe('/test/runtime')
      }
    })
  })

  test('a real process preserves multiple backend handshake frames in a single stdin chunk', async () => {
    const input = '{"stage":"request","digest":"test"}\n{"stage":"authorize","digest":"test"}\n'
    const child = await runChild('deploy', deploy, input)
    try {
      const output = await new Response(child.stdout).json()
      expect(await child.exited).toBe(0)
      expect(output).toEqual({
        request: { action: 'deploy', args: deploy },
        input,
        credentialNames: credentialKeys
      })
    } finally {
      child.kill()
    }
  })

  test('a real build process cannot observe ambient provider credentials', async () => {
    const child = await runChild('build', build, '')
    try {
      const output = await new Response(child.stdout).json()
      expect(await child.exited).toBe(0)
      expect(output).toMatchObject({ credentialNames: [] })
    } finally {
      child.kill()
    }
  })

  test('kill acts on the command process without leaving a wrapper child running', async () => {
    const child = await runChild('build', build, '', 'wait')
    try {
      const reader = child.stdout.getReader()
      const ready = await reader.read()
      expect(new TextDecoder().decode(ready.value)).toBe('ready\n')
      reader.releaseLock()
      child.kill()
      expect(await child.exited).not.toBe(0)
      expect(child.killed).toBe(true)
    } finally {
      child.kill()
    }
  })
})
