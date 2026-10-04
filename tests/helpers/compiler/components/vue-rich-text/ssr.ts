import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildOpenPencilVueRichText } from '#compiler/adapters/vue/modules/rich-text'
import { createSSRApp, h, type Component } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import { RICH_TEXT_MODULE_DEFAULT_CONFIG } from '@open-pencil/core/plugins'

export async function vueRichTextSSR(extra: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-vue-rich-text-'))
  try {
    await mkdir(join(directory, 'node_modules'))
    await symlink(resolve('node_modules/vue'), join(directory, 'node_modules/vue'), 'dir')
    const parsed = parse(buildOpenPencilVueRichText())
    if (parsed.errors.length) throw new Error('Invalid generated RichText SFC')
    const path = join(directory, 'RichText.ts')
    await writeFile(
      path,
      compileScript(parsed.descriptor, { id: 'rich-text-ssr', inlineTemplate: true }).content
    )
    const component = (await import(pathToFileURL(path).href)) as { default: Component }
    return await renderToString(
      createSSRApp({
        render: () => h(component.default, { config: RICH_TEXT_MODULE_DEFAULT_CONFIG, ...extra })
      })
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
