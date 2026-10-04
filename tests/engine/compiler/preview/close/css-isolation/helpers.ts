import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'

import { observeHMR } from '../ws-observer/helpers'

function files(target: 'react' | 'vue', utility: string) {
  const extension = target === 'react' ? 'tsx' : 'ts'
  return new Map([
    [
      'index.html',
      `<div id="root"></div><script type="module" src="/src/main.${extension}"></script>`
    ],
    [
      `src/main.${extension}`,
      target === 'react'
        ? `import React from 'react'; import {createRoot} from 'react-dom/client'; import './index.css'; createRoot(document.getElementById('root')).render(<p className="${utility}">Preview</p>);`
        : `import {createApp} from 'vue'; import './index.css'; createApp({template:'<p class="${utility}">Preview</p>'}).mount('#root');`
    ],
    ['src/index.css', `@import "tailwindcss"; @source inline("${utility}");`]
  ])
}

async function css(preview: PreviewServer, utility: string): Promise<string> {
  const response = await fetch(preview.url + 'src/index.css?import')
  assert.equal(response.status, 200)
  const code = await response.text()
  assert.ok(code.includes(`.${utility}`), 'The served stylesheet must contain its own utility')
  const id = code.match(/const __vite__id\s*=\s*["']([^"']+)["']/u)?.[1]
  assert.ok(id, 'The stylesheet must expose its actual transformed virtual file ID')
  return dirname(dirname(id))
}

async function entry(preview: PreviewServer, target: 'react' | 'vue'): Promise<void> {
  const response = await fetch(preview.url + (target === 'react' ? 'src/main.tsx' : 'src/main.ts'))
  assert.equal(response.status, 200)
  const code = await response.text()
  assert.ok(code.includes('index.css'))
  if (target === 'react')
    assert.ok(code.includes('jsxDEV'), 'The child root must inherit React JSX')
  const dependencies = [...code.matchAll(/(?:from\s*|import\s*)["']([^"']*\.vite\/[^"']+)["']/gu)]
  for (const match of dependencies) {
    const dependency = await fetch(new URL(match[1], preview.url))
    assert.equal(dependency.status, 200)
    assert.ok((await dependency.text()).length > 0)
  }
}

function externalMessages(messages: string[]): string[] {
  return messages.filter((type) => ['update', 'full-reload', 'error'].includes(type))
}

export async function checkCSSIsolation(directory: string, target: 'react' | 'vue'): Promise<void> {
  const first = await createPreviewServer({
    target,
    fsRoot: directory,
    initialFiles: files(target, 'text-red-500')
  })
  let second: PreviewServer | undefined
  let firstRoot: string | undefined
  let secondRoot: string | undefined
  let observer: Awaited<ReturnType<typeof observeHMR>> | undefined
  let failure: { error: unknown } | undefined
  try {
    await entry(first, target)
    firstRoot = await css(first, 'text-red-500')
    observer = await observeHMR(first.url)
    second = await createPreviewServer({
      target,
      fsRoot: directory,
      initialFiles: files(target, 'text-blue-500')
    })
    await entry(second, target)
    secondRoot = await css(second, 'text-blue-500')
    assert.notEqual(firstRoot, secondRoot)
    assert.ok(existsSync(firstRoot) && existsSync(secondRoot))
    await pause(300)
    process.stdout.write('css-probe: peer started; checking HMR\n')
    assert.deepEqual(
      externalMessages(observer.messages),
      [],
      'Peer startup must not reload this app'
    )
    process.stdout.write('css-probe: closing peer\n')
    await second.close()
    second = undefined
    assert.equal(existsSync(secondRoot), false)
    await pause(300)
    process.stdout.write('css-probe: peer closed; checking HMR\n')
    assert.deepEqual(
      externalMessages(observer.messages),
      [],
      'Peer shutdown must not reload this app'
    )
    assert.equal(await css(first, 'text-red-500'), firstRoot)

    // Positive control: the observer must receive this server's own CSS update.
    await first.updateFiles(files(target, 'text-green-500'))
    await pause(100)
    assert.ok(
      observer.messages.includes('update'),
      'The HMR observer must actually receive updates'
    )
    assert.equal(await css(first, 'text-green-500'), firstRoot)
    process.stdout.write('css-probe: own HMR verified\n')
  } catch (error) {
    failure = { error }
  } finally {
    try {
      if (observer) {
        await observer.close()
        process.stdout.write('css-probe: observer closed\n')
      }
      await Promise.all([first.close(), second?.close()])
      process.stdout.write('css-probe: cleanup complete\n')
    } catch (error) {
      failure ??= { error }
    }
  }
  if (failure) throw failure.error
  assert.ok(firstRoot)
  assert.equal(existsSync(firstRoot), false)
}
