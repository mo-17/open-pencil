import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { autocompleteRuntimeSource } from '#compiler/adapters/autocomplete/runtime'
import { reactAutocompleteSource } from '#compiler/adapters/react/autocomplete/runtime'
import { buildVueAutocompleteComponent } from '#compiler/adapters/vue/autocomplete/component'
import type * as React from 'react'
import type * as ReactDOMServer from 'react-dom/server'
import { createSSRApp, h, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

export async function renderAutocompleteSSR(target: 'react' | 'vue') {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-autocomplete-ssr-'))
  try {
    await mkdir(join(directory, 'src/components/open-pencil'), { recursive: true })
    await mkdir(join(directory, 'src/lib'))
    await mkdir(join(directory, 'node_modules'))
    await symlink(
      resolve('packages/compiler/node_modules/react'),
      join(directory, 'node_modules/react'),
      'dir'
    )
    await symlink(resolve('node_modules/vue'), join(directory, 'node_modules/vue'), 'dir')
    await writeFile(
      join(directory, 'src/lib/open-pencil-autocomplete.ts'),
      autocompleteRuntimeSource()
    )
    const props = {
      suggestions: ['北京', '厦门'],
      defaultValue: '自由 <b>文本</b>',
      name: 'city',
      'aria-label': '城市'
    }
    if (target === 'vue') {
      const parsed = parse(buildVueAutocompleteComponent())
      if (parsed.errors.length) throw new Error('Invalid generated autocomplete SFC')
      const path = join(directory, 'src/components/open-pencil/Autocomplete.ts')
      await writeFile(
        path,
        compileScript(parsed.descriptor, { id: 'autocomplete-ssr', inlineTemplate: true }).content
      )
      const component = (await import(pathToFileURL(path).href)) as { default: Component }
      return await renderToString(createSSRApp({ render: () => h(component.default, props) }))
    }
    const path = join(directory, 'src/components/Autocomplete.tsx')
    await writeFile(path, reactAutocompleteSource())
    const component = (await import(pathToFileURL(path).href)) as {
      OpenPencilAutocomplete: React.ComponentType<typeof props>
    }
    const compilerPackage = pathToFileURL(resolve('packages/compiler/package.json')).href
    const react = (await import(import.meta.resolve('react', compilerPackage))) as typeof React
    const renderer = (await import(
      import.meta.resolve('react-dom/server', compilerPackage)
    )) as typeof ReactDOMServer
    return renderer.renderToStaticMarkup(
      react.createElement(component.OpenPencilAutocomplete, props)
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
