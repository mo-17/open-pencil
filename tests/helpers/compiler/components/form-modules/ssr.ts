import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildOpenPencilDateRangeComponent } from '#compiler/adapters/react/modules/date-range'
import { buildOpenPencilRatingComponent } from '#compiler/adapters/react/modules/rating'
import { buildOpenPencilSliderComponent } from '#compiler/adapters/react/modules/slider'
import { buildOpenPencilVueDateRange } from '#compiler/adapters/vue/modules/date-range'
import { buildOpenPencilVueRating } from '#compiler/adapters/vue/modules/rating'
import { buildOpenPencilVueSlider } from '#compiler/adapters/vue/modules/slider'
import type * as React from 'react'
import type * as ReactDOMServer from 'react-dom/server'
import { createSSRApp, h, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import {
  SLIDER_MODULE_DEFAULT_CONFIG,
  RATING_MODULE_DEFAULT_CONFIG,
  DATE_RANGE_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'

export async function renderFormModuleSSR(
  target: 'react' | 'vue',
  kind: 'slider' | 'rating' | 'date',
  invalid: boolean,
  mode: 'editable' | 'readonly' | 'disabled' = 'editable'
) {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-form-modules-ssr-'))
  try {
    await mkdir(join(directory, 'node_modules'))
    await symlink(
      resolve('packages/compiler/node_modules/react'),
      join(directory, 'node_modules/react'),
      'dir'
    )
    await symlink(resolve('node_modules/vue'), join(directory, 'node_modules/vue'), 'dir')
    const builders = {
      slider: [buildOpenPencilSliderComponent, buildOpenPencilVueSlider],
      rating: [buildOpenPencilRatingComponent, buildOpenPencilVueRating],
      date: [buildOpenPencilDateRangeComponent, buildOpenPencilVueDateRange]
    }
    const config = {
      ...{
        slider: SLIDER_MODULE_DEFAULT_CONFIG,
        rating: RATING_MODULE_DEFAULT_CONFIG,
        date: DATE_RANGE_MODULE_DEFAULT_CONFIG
      }[kind],
      label: 'Field <script>',
      range: true
    }
    const validValue = kind === 'date' ? '2026-09-01' : 2
    const validEnd = kind === 'date' ? '2026-09-05' : 4
    const props = {
      config,
      readOnly: mode === 'readonly',
      disabled: mode === 'disabled',
      valueBound: true,
      value: invalid ? undefined : validValue,
      field: { name: 'first', required: true },
      ...(kind === 'rating'
        ? {}
        : {
            endValueBound: true,
            endValue: invalid ? 'invalid' : validEnd,
            endField: { name: 'last' }
          }),
      form: 'owner',
      lang: 'en'
    }
    if (target === 'vue') {
      const parsed = parse(builders[kind][1]())
      if (parsed.errors.length) throw new Error('Invalid SFC')
      const path = join(directory, 'Field.ts')
      await writeFile(
        path,
        compileScript(parsed.descriptor, { id: 'field-ssr', inlineTemplate: true }).content
      )
      const component = (await import(pathToFileURL(path).href)) as { default: Component }
      return await renderToString(createSSRApp({ render: () => h(component.default, props) }))
    }
    const path = join(directory, 'Field.tsx')
    await writeFile(path, builders[kind][0]())
    const component = (await import(pathToFileURL(path).href)) as {
      default: React.ComponentType<typeof props>
    }
    const compiler = pathToFileURL(resolve('packages/compiler/package.json')).href
    const react = (await import(import.meta.resolve('react', compiler))) as typeof React,
      renderer = (await import(
        import.meta.resolve('react-dom/server', compiler)
      )) as typeof ReactDOMServer
    return renderer.renderToStaticMarkup(react.createElement(component.default, props))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
