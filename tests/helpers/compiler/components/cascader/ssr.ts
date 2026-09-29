import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildOpenPencilCascaderComponent } from '#compiler/adapters/react/modules/cascader'
import { buildOpenPencilVueCascader } from '#compiler/adapters/vue/modules/cascader'
import type * as React from 'react'
import type * as ReactDOMServer from 'react-dom/server'
import { createSSRApp, h, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import { CASCADER_MODULE_DEFAULT_CONFIG } from '#core/plugins/cascader'

export async function cascaderSSR(target: 'react' | 'vue', extra: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-cascader-ssr-'))
  try {
    await mkdir(join(directory, 'node_modules'))
    await symlink(
      resolve('packages/compiler/node_modules/react'),
      join(directory, 'node_modules/react'),
      'dir'
    )
    await symlink(resolve('node_modules/vue'), join(directory, 'node_modules/vue'), 'dir')
    const props = { config: CASCADER_MODULE_DEFAULT_CONFIG, lang: 'en', ...extra }
    if (target === 'vue') {
      const parsed = parse(buildOpenPencilVueCascader()),
        path = join(directory, 'Cascader.ts')
      if (parsed.errors.length) throw new Error('Invalid Cascader SFC')
      await writeFile(
        path,
        compileScript(parsed.descriptor, { id: 'cascader-ssr', inlineTemplate: true }).content
      )
      const component = (await import(pathToFileURL(path).href)) as { default: Component }
      return await renderToString(createSSRApp({ render: () => h(component.default, props) }))
    }
    const path = join(directory, 'Cascader.tsx')
    await writeFile(path, buildOpenPencilCascaderComponent())
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
