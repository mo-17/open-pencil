import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type * as React from 'react'
import type * as ReactDOMServer from 'react-dom/server'
import { createSSRApp, h, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import type { InputControlConfig } from '@open-pencil/lowcode'

import { inputControlRuntimeFixture } from './runtime'

function inputControlSSRDefaults(kind: InputControlConfig['kind']): {
  config: InputControlConfig
  defaultValue: string
} {
  if (kind === 'color') return { config: { kind, readOnly: false }, defaultValue: '#2563eb' }
  if (kind === 'password') return { config: { kind }, defaultValue: '秘密 <b>text</b>' }
  return { config: { kind, showStepper: true, placement: 'end' }, defaultValue: '0.2' }
}

export async function renderInputControlSSR(
  target: 'react' | 'vue',
  kind: 'number' | 'password' | 'color'
) {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-input-control-ssr-'))
  try {
    const { files } = inputControlRuntimeFixture(target)
    await mkdir(join(directory, 'src/components/open-pencil'), { recursive: true })
    await mkdir(join(directory, 'src/lib'))
    await mkdir(join(directory, 'node_modules'))
    await symlink(
      resolve('packages/compiler/node_modules/react'),
      join(directory, 'node_modules/react'),
      'dir'
    )
    await symlink(resolve('node_modules/vue'), join(directory, 'node_modules/vue'), 'dir')
    const numericDraft = files.find(([name]) => name === 'src/lib/open-pencil-number-draft.ts')?.[1]
    if (typeof numericDraft !== 'string') throw new Error('Missing generated numeric-draft runtime')
    await writeFile(join(directory, 'src/lib/open-pencil-number-draft.ts'), numericDraft)
    const runtime = files.find(([name]) => name === 'src/lib/open-pencil-input-control.ts')?.[1]
    if (typeof runtime !== 'string') throw new Error('Missing generated native-input runtime')
    await writeFile(join(directory, 'src/lib/open-pencil-input-control.ts'), runtime)
    const props = {
      ...inputControlSSRDefaults(kind),
      name: 'field',
      id: 'field',
      form: 'external',
      'aria-label': '输入',
      'data-node-id': 'field-node',
      'data-business-key': 'field-key',
      min: '0.1',
      max: '1',
      step: '0.1'
    }
    if (target === 'vue') {
      const source = files.find(
        ([name]) => name === 'src/components/open-pencil/OpenPencilInputControl.vue'
      )?.[1]
      if (typeof source !== 'string')
        throw new Error('Missing generated Vue native-input component')
      const parsed = parse(source)
      if (parsed.errors.length) throw new Error('Invalid generated native-input SFC')
      const path = join(directory, 'src/components/open-pencil/Input.ts')
      await writeFile(
        path,
        compileScript(parsed.descriptor, { id: 'input-control-ssr', inlineTemplate: true }).content
      )
      const component = (await import(pathToFileURL(path).href)) as { default: Component }
      return await renderToString(createSSRApp({ render: () => h(component.default, props) }))
    }
    const source = files.find(
      ([name]) => name === 'src/components/_open-pencil-input-control.tsx'
    )?.[1]
    if (typeof source !== 'string')
      throw new Error('Missing generated React native-input component')
    const path = join(directory, 'src/components/Input.tsx')
    await writeFile(path, source)
    const component = (await import(pathToFileURL(path).href)) as {
      OpenPencilInputControl: React.ComponentType<typeof props>
    }
    const compilerPackage = pathToFileURL(resolve('packages/compiler/package.json')).href
    const react = (await import(import.meta.resolve('react', compilerPackage))) as typeof React
    const renderer = (await import(
      import.meta.resolve('react-dom/server', compilerPackage)
    )) as typeof ReactDOMServer
    return renderer.renderToStaticMarkup(
      react.createElement(component.OpenPencilInputControl, props)
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
