import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildOpenPencilPaginationComponent } from '#compiler/adapters/react/modules/pagination'
import { buildOpenPencilVuePagination } from '#compiler/adapters/vue/modules/pagination'
import type * as React from 'react'
import type * as ReactDOMServer from 'react-dom/server'
import { createSSRApp, h, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import { PAGINATION_MODULE_DEFAULT_CONFIG } from '@open-pencil/core/plugins'

export async function renderPaginationSSR(target: 'react' | 'vue', invalid = false) {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-pagination-ssr-'))
  try {
    await mkdir(join(directory, 'node_modules'))
    await symlink(
      resolve('packages/compiler/node_modules/react'),
      join(directory, 'node_modules/react'),
      'dir'
    )
    await symlink(resolve('node_modules/vue'), join(directory, 'node_modules/vue'), 'dir')
    const props = {
      config: { ...PAGINATION_MODULE_DEFAULT_CONFIG, label: 'Pages <script>' },
      currentPageBound: true,
      currentPage: invalid ? undefined : 2,
      lang: 'en',
      onPageChange: () => {
        throw new Error('SSR must not write state')
      }
    }
    if (target === 'vue') {
      const parsed = parse(buildOpenPencilVuePagination())
      if (parsed.errors.length) throw new Error('Invalid Pagination SFC')
      const path = join(directory, 'Pagination.ts')
      await writeFile(
        path,
        compileScript(parsed.descriptor, { id: 'pagination-ssr', inlineTemplate: true }).content
      )
      const component = (await import(pathToFileURL(path).href)) as { default: Component }
      return await renderToString(createSSRApp({ render: () => h(component.default, props) }))
    }
    const path = join(directory, 'Pagination.tsx')
    await writeFile(path, buildOpenPencilPaginationComponent())
    const component = (await import(pathToFileURL(path).href)) as {
      default: React.ComponentType<typeof props>
    }
    const compilerPackage = pathToFileURL(resolve('packages/compiler/package.json')).href
    const react = (await import(import.meta.resolve('react', compilerPackage))) as typeof React
    const renderer = (await import(
      import.meta.resolve('react-dom/server', compilerPackage)
    )) as typeof ReactDOMServer
    return renderer.renderToStaticMarkup(react.createElement(component.default, props))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
