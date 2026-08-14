import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import {
  parseCodePenSidecarResponse,
  serializeCodePenSidecarRequest,
  type CodePenSidecarTarget
} from '@open-pencil/compiler/codepen/sidecar-wire'

import {
  codePenSidecarOutputPath,
  parseCodePenSidecarTarget,
  verifyCodePenSidecarBinary,
  type CodePenSidecarTargetTriple
} from './build'

interface SmokeOptions {
  target: CodePenSidecarTargetTriple
  binary?: string
}

function parseSmokeOptions(args: readonly string[]): SmokeOptions {
  let target: CodePenSidecarTargetTriple | undefined
  let binary: string | undefined
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--target' && index + 1 < args.length && !target) {
      target = parseCodePenSidecarTarget(args[++index])
      continue
    }
    if (argument.startsWith('--target=') && !target) {
      target = parseCodePenSidecarTarget(argument.slice('--target='.length))
      continue
    }
    if (argument === '--binary' && index + 1 < args.length && !binary) {
      binary = args[++index]
      continue
    }
    if (argument.startsWith('--binary=') && !binary) {
      binary = argument.slice('--binary='.length)
      continue
    }
    throw new Error(`Unknown or duplicate CodePen sidecar smoke option: ${argument}`)
  }
  if (!target) throw new Error('CodePen sidecar smoke requires --target <triple>')
  if (binary !== undefined) {
    const expected = `openpencil-codepen-sidecar${target.includes('windows') ? '.exe' : ''}`
    if (basename(binary) !== expected) {
      throw new Error(`Packaged CodePen sidecar must be named ${expected}`)
    }
  }
  return { target, ...(binary === undefined ? {} : { binary }) }
}

function hostTarget(): CodePenSidecarTargetTriple {
  const key = `${process.platform}:${process.arch}`
  const targets: Readonly<Partial<Record<string, CodePenSidecarTargetTriple>>> = Object.freeze({
    'darwin:arm64': 'aarch64-apple-darwin',
    'darwin:x64': 'x86_64-apple-darwin',
    'win32:x64': 'x86_64-pc-windows-msvc',
    'win32:arm64': 'aarch64-pc-windows-msvc',
    'linux:x64': 'x86_64-unknown-linux-gnu'
  })
  const target = targets[key]
  if (!target) throw new Error(`Unsupported CodePen sidecar smoke host ${key}`)
  return target
}

function smokeFiles(target: CodePenSidecarTarget, packageName: string): Map<string, string> {
  if (target === 'react') {
    return new Map([
      [
        'package.json',
        JSON.stringify({
          name: packageName,
          dependencies: {
            '@radix-ui/react-slot': '^1.1.1',
            react: '^19.2.0',
            'react-dom': '^19.2.0'
          }
        })
      ],
      [
        'src/main.tsx',
        "import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport { Button } from '@/components/ui/button'\nimport './index.css'\ncreateRoot(document.getElementById('root')!).render(<main className=\"smoke-shell\"><Button>openpencil-react-smoke</Button></main>)\n"
      ],
      [
        'src/components/ui/button.tsx',
        "import * as React from 'react'\nimport { Slot } from '@radix-ui/react-slot'\nexport function Button({ asChild = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) { const Component = asChild ? Slot : 'button'; return <Component className=\"rounded bg-blue-500 px-4\" {...props} /> }\n"
      ],
      ['src/index.css', '@import "tailwindcss";\n.smoke-shell { box-sizing: border-box; }\n']
    ])
  }
  return new Map([
    ['package.json', JSON.stringify({ name: packageName, dependencies: { vue: '^3.5.29' } })],
    [
      'src/main.ts',
      "import { createApp } from 'vue'\nimport App from './App.vue'\nimport './index.css'\ncreateApp(App).mount('#app')\n"
    ],
    [
      'src/App.vue',
      '<script setup lang="ts">\nimport { ref } from \'vue\'\nconst label = ref(\'openpencil-vue-smoke\')\n</script>\n<template><main class="vue-smoke-shell font-bold">{{ label }}</main></template>\n<style scoped>.vue-smoke-shell { color: rgb(1 2 3); }</style>\n'
    ],
    ['src/index.css', '@import "tailwindcss";\n.vue-global-smoke { box-sizing: border-box; }\n']
  ])
}

function smokeEnvironment(directory: string): Record<string, string> {
  if (process.platform === 'win32') {
    return {
      SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
      TEMP: directory,
      TMP: directory
    }
  }
  return { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TMPDIR: directory }
}

async function runTarget(
  binary: string,
  target: CodePenSidecarTarget,
  directory: string
): Promise<void> {
  const requestId = `release-smoke-${target}`
  const packageName = `openpencil-${target}-release-smoke`
  const serialized = serializeCodePenSidecarRequest({
    requestId,
    target,
    packageName,
    files: smokeFiles(target, packageName),
    options: { title: `OpenPencil ${target} release smoke` }
  })
  if (serialized.includes('\n') || serialized.includes('\r')) {
    throw new Error('CodePen sidecar serializer returned transport framing')
  }

  const child = Bun.spawn([binary], {
    cwd: directory,
    env: smokeEnvironment(directory),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe'
  })
  await child.stdin.write(`${serialized}\n`)
  await child.stdin.end()
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])
  if (stderr.length !== 0) throw new Error(`CodePen sidecar wrote ${stderr.length} stderr bytes`)
  const lines = stdout.endsWith('\n') ? stdout.slice(0, -1).split('\n') : []
  if (lines.length !== 1) throw new Error('CodePen sidecar did not write exactly one JSON line')
  const response = parseCodePenSidecarResponse(lines[0], requestId)
  if (exitCode !== 0 || !response.ok) {
    const detail = response.ok
      ? 'unexpected nonzero exit'
      : `${response.error.code}: ${response.error.message}`
    throw new Error(`CodePen ${target} release smoke failed with status ${exitCode} (${detail})`)
  }
  if (
    response.result.target !== target ||
    response.result.packageName !== packageName ||
    !response.result.data.html.includes('type="importmap"') ||
    !response.result.data.js.includes(`openpencil-${target}-smoke`) ||
    !response.result.data.css.includes(target === 'react' ? 'smoke-shell' : 'vue-smoke-shell')
  ) {
    throw new Error(`CodePen ${target} release smoke response is incomplete`)
  }
  const expectedUtilities =
    target === 'react' ? ['.rounded', '.bg-blue-500', '.px-4'] : ['.font-bold']
  if (expectedUtilities.some((utility) => !response.result.data.css.includes(utility))) {
    throw new Error(`CodePen ${target} release smoke omitted Tailwind utility CSS`)
  }
  process.stdout.write(
    `Smoked ${target} (${response.result.data.js.length} JS bytes, ${response.result.diagnostics.length} diagnostics)\n`
  )
}

async function main(): Promise<void> {
  const { target, binary = codePenSidecarOutputPath(target) } = parseSmokeOptions(Bun.argv.slice(2))
  const host = hostTarget()
  if (target !== host) {
    throw new Error(`Refusing to execute ${target} CodePen sidecar on ${host} host`)
  }
  const executable = resolve(binary)
  await verifyCodePenSidecarBinary(target, executable)
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-codepen-sidecar-smoke-'))
  try {
    await runTarget(executable, 'react', directory)
    await runTarget(executable, 'vue', directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

if (import.meta.main) await main()
