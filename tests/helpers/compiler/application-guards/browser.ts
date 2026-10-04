import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import { withModuleFormCleanup } from '../components/form-module/lifecycle'
import { withComponentTemplateFiles } from '../components/templates/browser'

async function routerDependency(name: string): Promise<string> {
  const cache = resolve('node_modules/.bun')
  const prefix = `${name}@7.18.3+`
  const entry = (await readdir(cache)).find((item) => item.startsWith(prefix))
  if (!entry) throw new Error(`Missing already cached ${name}@7.18.3; no dependency was installed`)
  return join(cache, entry, 'node_modules', name)
}

function installedDependency(name: string): string {
  let directory = dirname(fileURLToPath(import.meta.resolve(name)))
  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`Missing existing test dependency: ${name}`)
    directory = parent
  }
  return directory
}

/** Run the generated manifest's router version without mutating workspace/ancestor dependencies. */
export async function withApplicationGuardsFiles(
  page: Page,
  target: 'react' | 'vue',
  files: Map<string, string>,
  run: () => Promise<void>
): Promise<void> {
  if (target === 'vue') return withComponentTemplateFiles(page, target, files, run)
  const manifest = JSON.parse(files.get('package.json') ?? '{}') as {
    dependencies?: Record<string, string>
  }
  expect(manifest.dependencies?.['react-router-dom']).toBe('^7.18.3')
  const root = await mkdtemp(join(tmpdir(), 'openpencil-guards-browser-'))
  try {
    for (const name of new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      'react-router',
      'tailwindcss',
      '@tailwindcss/vite'
    ])) {
      const installed =
        name === 'react-router' || name === 'react-router-dom'
          ? await routerDependency(name)
          : installedDependency(name)
      if (!existsSync(join(installed, 'package.json')))
        throw new Error(`Missing existing test dependency: ${name}`)
      const destination = join(root, 'node_modules', name)
      await mkdir(dirname(destination), { recursive: true })
      await symlink(installed, destination, 'dir')
    }
    // Match the server's two explicit dependency roots, including cached router artifacts.
    await mkdir(join(root, 'packages/compiler'), { recursive: true })
    await symlink(resolve('node_modules'), join(root, 'packages/compiler/node_modules'), 'dir')
    const { createPreviewServer } = await import(
      pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
    )
    const server: PreviewServer = await createPreviewServer({
      target,
      initialFiles: files,
      fsRoot: root
    })
    const errors: string[] = []
    const capture = (error: Error) => errors.push(error.message)
    page.on('pageerror', capture)
    try {
      await withModuleFormCleanup(
        async () => {
          await page.goto(server.url, { waitUntil: 'networkidle' })
          await run()
          expect(errors).toEqual([])
        },
        async () => {
          if (!page.isClosed()) await page.goto('about:blank')
        },
        () => server.close()
      )
    } finally {
      page.off('pageerror', capture)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
