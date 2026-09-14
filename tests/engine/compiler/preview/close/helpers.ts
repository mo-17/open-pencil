import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'

const directory = process.argv[2]
const mode = process.argv[3]
if (!directory || !['react', 'vue', 'parallel'].includes(mode))
  throw new Error('Invalid fixture arguments')

// The nearest package and physical node_modules isolate Vite's optimizer cache.
// Dependencies still resolve from the real workspace through ancestor lookup.
writeFileSync(
  join(directory, 'package.json'),
  '{"name":"preview-close-fixture","private":true,"type":"module"}'
)
mkdirSync(join(directory, 'node_modules'), { recursive: true })
mkdirSync(join(directory, 'packages/compiler/node_modules'), { recursive: true })
assert.equal(existsSync(join(directory, 'packages/compiler/.preview-root')), false)

function previewFiles(target: 'react' | 'vue') {
  const extension = target === 'react' ? 'tsx' : 'ts'
  return new Map([
    [
      'index.html',
      `<div id="root"></div><script type="module" src="/src/main.${extension}"></script>`
    ],
    [
      `src/main.${extension}`,
      target === 'react'
        ? `import React from 'react'; import {createRoot} from 'react-dom/client'; createRoot(document.getElementById('root')).render(<p>Cold preview</p>);`
        : `import {createApp} from 'vue'; createApp({template:'<p>Cold preview</p>'}).mount('#root');`
    ]
  ])
}

async function serveEntry(preview: PreviewServer, target: 'react' | 'vue'): Promise<string> {
  let code = ''
  for (const path of ['', target === 'react' ? 'src/main.tsx' : 'src/main.ts']) {
    const response = await fetch(preview.url + path)
    assert.equal(response.status, 200)
    code = await response.text()
    assert.ok(code.length > 0)
  }
  return code
}

async function checkPortReleased(preview: PreviewServer): Promise<void> {
  const rebound = createServer()
  try {
    rebound.listen(preview.port, '127.0.0.1')
    await once(rebound, 'listening')
    assert.equal(rebound.listening, true)
    await preview.close()
    // Calling the already closed preview must not affect a new port owner.
    assert.equal(rebound.listening, true)
  } finally {
    await promisify(rebound.close.bind(rebound))()
  }
}

async function loadDependencies(preview: PreviewServer, code: string): Promise<string[]> {
  const urls = [
    ...code.matchAll(/(?:from\s*|import\s*)["']([^"']*\.vite\/deps\/[^"']+)["']/gu)
  ].map((match) => new URL(match[1], preview.url).href)
  assert.ok(urls.length > 0, 'The transformed entry must use real optimized dependencies')
  await checkDependencyURLs(urls)
  return urls
}

async function checkDependencyURLs(urls: string[]): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url)
      assert.equal(response.status, 200, url)
      assert.ok(response.headers.get('content-type')?.includes('javascript'))
      assert.ok((await response.text()).length > 0)
    })
  )
}

if (mode === 'react' || mode === 'vue') {
  const preview = await createPreviewServer({
    target: mode,
    fsRoot: directory,
    initialFiles: previewFiles(mode)
  })
  try {
    await serveEntry(preview, mode)
  } finally {
    // Do not wait for optimizer/browser idle: closing with pending dependency
    // transforms is the regression. Both callers must await actual cleanup.
    await Promise.all([preview.close(), preview.close()])
  }
  await checkPortReleased(preview)
  process.stdout.write(
    mode + ': cold entry served; closed; port rebound; repeated close complete\n'
  )
} else {
  const react = await createPreviewServer({
    target: 'react',
    fsRoot: directory,
    initialFiles: previewFiles('react')
  })
  let vue: PreviewServer | undefined
  try {
    const oldReactURLs = await loadDependencies(react, await serveEntry(react, 'react'))
    const cache = (target: string) =>
      join(directory, 'packages/compiler/.preview-root', target, '.vite/deps/_metadata.json')
    const reactMetadata = readFileSync(cache('react'), 'utf8')
    vue = await createPreviewServer({
      target: 'vue',
      fsRoot: directory,
      initialFiles: previewFiles('vue')
    })
    assert.notEqual(react.port, vue.port)
    const [reactEntry, vueEntry] = await Promise.all([
      serveEntry(react, 'react'),
      serveEntry(vue, 'vue')
    ])
    await Promise.all([loadDependencies(react, reactEntry), loadDependencies(vue, vueEntry)])
    assert.equal(readFileSync(cache('react'), 'utf8'), reactMetadata)
    assert.ok(readFileSync(cache('vue'), 'utf8').includes('"vue"'))
    // Keep the original versioned React URLs: starting Vue must neither delete
    // their files nor require the existing React client to reload.
    await checkDependencyURLs(oldReactURLs)
  } finally {
    await Promise.all([react.close(), react.close(), vue?.close(), vue?.close()])
  }
  await checkPortReleased(react)
  if (vue) await checkPortReleased(vue)
  process.stdout.write(
    'parallel: caches isolated; original modules retained; both ports released\n'
  )
}
