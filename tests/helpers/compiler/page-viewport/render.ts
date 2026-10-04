import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSSRApp, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import { pageViewportFixture } from './fixture'

/** Execute actual generated page and shell components without a browser or build server. */
export async function renderPageViewport(
  target: 'react' | 'vue',
  mode: 'responsive' | 'fit-width'
) {
  const output = pageViewportFixture(target, mode, true)
  output.files.delete('src/__preview-bridge.ts')
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-viewport-ssr-'))
  try {
    const dependencies = target === 'react' ? ['react', 'react-dom'] : ['vue']
    await mkdir(join(directory, 'node_modules'), { recursive: true })
    for (const dependency of dependencies) {
      const packageDirectory = dirname(
        fileURLToPath(import.meta.resolve(dependency + '/package.json'))
      )
      await symlink(packageDirectory, join(directory, 'node_modules', dependency), 'dir')
    }
    for (const [path, value] of output.files) {
      if (typeof value !== 'string' || !path.startsWith('src/')) continue
      const destination = join(directory, path.endsWith('.vue') ? path.slice(0, -4) + '.ts' : path)
      await mkdir(dirname(destination), { recursive: true })
      let source = value
      if (path.endsWith('.vue')) {
        const { descriptor, errors } = parse(value, { filename: path })
        if (errors.length) throw new Error('Generated Vue page parse failed: ' + String(errors[0]))
        source = compileScript(descriptor, { id: path, inlineTemplate: true })
          .content.replaceAll(".vue'", ".ts'")
          .replaceAll('.vue"', '.ts"')
      }
      // A dev bridge is browser-owned; remove its explicit import for server rendering only.
      source = source.replace(/^import ['"].*__preview-bridge['"]\s*$/gm, '')
      await writeFile(destination, source)
    }
    if (target === 'react') {
      const module = (await import(pathToFileURL(join(directory, 'src/App.tsx')).href)) as {
        default: ComponentType
      }
      return renderToStaticMarkup(createElement(module.default))
    }
    const module = (await import(pathToFileURL(join(directory, 'src/pages/index.ts')).href)) as {
      default: Component
    }
    return await renderToString(createSSRApp(module.default))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
