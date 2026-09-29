import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildOpenPencilOrgChartComponent } from '#compiler/adapters/react/modules/org-chart'
import { buildOpenPencilVueOrgChart } from '#compiler/adapters/vue/modules/org-chart'
import type * as React from 'react'
import type * as ReactDOMServer from 'react-dom/server'
import { createSSRApp, h, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import { ORG_CHART_MODULE_DEFAULT_CONFIG } from '@open-pencil/core/plugins'

export async function renderOrgChartSSR(target: 'react' | 'vue') {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-org-chart-ssr-'))
  try {
    await mkdir(join(directory, 'node_modules'))
    await symlink(
      resolve('packages/compiler/node_modules/react'),
      join(directory, 'node_modules/react'),
      'dir'
    )
    await symlink(resolve('node_modules/vue'), join(directory, 'node_modules/vue'), 'dir')
    const props = {
      config: {
        ...ORG_CHART_MODULE_DEFAULT_CONFIG,
        label: 'Organization <script>',
        initialCollapsedIds: ['root'],
        items: [
          { id: 'root', parentId: '', label: 'CEO <script>', description: 'Leadership & design' },
          { id: 'child', parentId: 'root', label: 'Hidden child', description: '' }
        ]
      },
      lang: 'en'
    }
    if (target === 'vue') {
      const parsed = parse(buildOpenPencilVueOrgChart())
      if (parsed.errors.length) throw new Error('Invalid OrgChart SFC')
      const path = join(directory, 'OrgChart.ts')
      await writeFile(
        path,
        compileScript(parsed.descriptor, { id: 'org-chart-ssr', inlineTemplate: true }).content
      )
      const component = (await import(pathToFileURL(path).href)) as { default: Component }
      return await renderToString(createSSRApp({ render: () => h(component.default, props) }))
    }
    const path = join(directory, 'OrgChart.tsx')
    await writeFile(path, buildOpenPencilOrgChartComponent())
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
