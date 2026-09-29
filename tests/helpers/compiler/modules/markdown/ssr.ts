import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildOpenPencilMarkdownComponent } from '#compiler/adapters/react/modules/markdown'
import { buildOpenPencilVueMarkdown } from '#compiler/adapters/vue/modules/markdown'
import { installedMarkdownDependency } from '#compiler/markdown-dependencies'
import type * as React from 'react'
import type * as ReactDOMServer from 'react-dom/server'
import { createSSRApp, h, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import type { MarkdownModuleConfigV1 } from '#core/plugins/markdown'

const compilerPackage = pathToFileURL(resolve('packages/compiler/package.json')).href

function packageDirectory(name: string): string {
  const directory =
    [resolve('packages/compiler/node_modules', name), resolve('node_modules', name)].find(
      existsSync
    ) ?? installedMarkdownDependency(name, process.cwd())
  if (!directory) throw new Error('Missing installed SSR package: ' + name)
  return realpathSync(directory)
}

export async function renderMarkdownSSR(
  target: 'react' | 'vue',
  config: MarkdownModuleConfigV1,
  lang = 'en',
  count = 1
): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-markdown-ssr-'))
  try {
    mkdirSync(join(directory, 'node_modules'))
    for (const name of [
      'react',
      'vue',
      'react-markdown',
      'remark-gfm',
      'unified',
      'remark-parse',
      'remark-rehype'
    ])
      symlinkSync(packageDirectory(name), join(directory, 'node_modules', name), 'dir')
    let source = buildOpenPencilMarkdownComponent()
    if (target === 'vue') {
      const parsed = parse(buildOpenPencilVueMarkdown())
      if (parsed.errors.length) {
        const error = parsed.errors[0]
        throw new Error(typeof error === 'string' ? error : error.message)
      }
      source = compileScript(parsed.descriptor, {
        id: 'markdown-ssr',
        inlineTemplate: true
      }).content
    }
    const path = join(directory, target === 'react' ? 'runtime.tsx' : 'runtime.ts')
    writeFileSync(path, source)
    const result = (await import(pathToFileURL(path).href)) as {
      default: Component & React.ComponentType<{ config: MarkdownModuleConfigV1; lang: string }>
    }
    if (target === 'vue')
      return await renderToString(
        createSSRApp({
          render: () =>
            h(
              'main',
              Array.from({ length: count }, (_, key) => h(result.default, { config, lang, key }))
            )
        })
      )
    const { createElement } = (await import(
      import.meta.resolve('react', compilerPackage)
    )) as typeof React
    const { renderToStaticMarkup } = (await import(
      import.meta.resolve('react-dom/server', compilerPackage)
    )) as typeof ReactDOMServer
    return renderToStaticMarkup(
      createElement(
        'main',
        {},
        ...Array.from({ length: count }, (_, key) =>
          createElement(result.default, { config, lang, key })
        )
      )
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
