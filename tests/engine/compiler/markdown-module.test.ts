import { expect, test } from 'bun:test'

import { buildOpenPencilMarkdownComponent } from '#compiler/adapters/react/modules/markdown'
import { buildOpenPencilVueMarkdown } from '#compiler/adapters/vue/modules/markdown'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createMarkdownModuleFrameOverrides,
  MARKDOWN_MODULE_DEFAULT_CONFIG
} from '#core/plugins/markdown'

import { renderMarkdownSSR } from '#tests/helpers/compiler/modules/markdown/ssr'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

const content =
  '# 中文标题\n\n**粗体** and *emphasis*\n\n- [x] 已完成\n- [ ] 未完成\n\n~~删除~~\n\n| 名称 | 值 |\n| :--- | ---: |\n| 项目 | 12 |\n\n正文[^note]\n\n[^note]: 脚注内容\n\n```html\n<script>literal_code()</script>\n```\n\n[安全](https://example.com/) [危险](javascript:alert(1)) [本机](https://127.0.0.1/) [页面](/safe/path)\n\n![图片说明](https://assets.example.com/tracker.png)\n\n<script>unsafe_script()</script>'

for (const target of ['react', 'vue'] as const) {
  test(`${target} repeated CJK footnotes retain local reference identities across SSR instances`, async () => {
    const html = await renderMarkdownSSR(
      target,
      {
        ...MARKDOWN_MODULE_DEFAULT_CONFIG,
        source: '正文[^说明] 与重复引用[^说明]。\n\n[^说明]: 中文脚注。',
        linkTarget: 'new-tab'
      },
      'zh-CN',
      2
    )
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    expect(ids).toHaveLength(8)
    expect(new Set(ids).size).toBe(ids.length)
    const links = [...html.matchAll(/<a\s[^>]*>/g)].map((match) => match[0])
    expect(links).toHaveLength(8)
    for (const link of links) {
      const href = /href="#([^"]+)"/.exec(link)?.[1]
      expect(href).toBeDefined()
      expect(ids).toContain(href)
      expect(link).not.toContain('target="_blank"')
      const description = /aria-describedby="([^"]+)"/.exec(link)?.[1]
      if (description) expect(ids).toContain(description)
    }
    expect(links.filter((link) => link.includes('data-footnote-ref'))).toHaveLength(4)
    expect(links.filter((link) => link.includes('data-footnote-backref'))).toHaveLength(4)
    expect(html).toContain('aria-label="返回引用 1"')
    expect(html).toContain('aria-label="返回引用 1-2"')
    expect(html).not.toContain('id="footnote-label"')
  })
  test(`${target} Markdown uses real GFM semantics and inert HTML/media in SSR without browser globals`, async () => {
    const html = await renderMarkdownSSR(
      target,
      { ...MARKDOWN_MODULE_DEFAULT_CONFIG, source: content, linkTarget: 'new-tab' },
      'zh-CN'
    )
    expect(html).toContain('<h1')
    expect(html).toContain('中文标题')
    expect(html).toContain('<strong>粗体</strong>')
    expect(html).toContain('<em>emphasis</em>')
    expect(html).toContain('<del>删除</del>')
    expect(html).toContain('<table')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('disabled')
    expect(html).toContain('脚注内容')
    expect(html).toContain('&lt;script&gt;literal_code()&lt;/script&gt;')
    expect(html).not.toContain('unsafe_script()')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('tracker.png')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="https://127.0.0.1/')
    expect(html).toContain('href="https://example.com/"')
    expect(html).toContain('href="/safe/path"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('nofollow noopener noreferrer')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="图片说明"')
  })
  test(`${target} CommonMark leaves GFM-only syntax literal and separates per-instance language`, async () => {
    const config = {
      ...MARKDOWN_MODULE_DEFAULT_CONFIG,
      source:
        '~~删除~~\n\n- [x] Task\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![](https://assets.example.com/image.png)',
      flavor: 'commonmark' as const
    }
    const chinese = await renderMarkdownSSR(target, config, 'zh-CN')
    const english = await renderMarkdownSSR(target, config, 'en')
    for (const html of [chinese, english]) {
      expect(html).not.toContain('<table')
      expect(html).not.toContain('<del>')
      expect(html).not.toContain('type="checkbox"')
      expect(html).toContain('~~删除~~')
      expect(html).toContain('[x] Task')
    }
    expect(chinese).toContain('aria-label="Markdown 图片"')
    expect(english).toContain('aria-label="Markdown image"')
  })
  test(`${target} Markdown generated project compiles and typechecks with existing parser dependencies`, () => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, createMarkdownModuleFrameOverrides({ source: content }))
    const result = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target, router: 'none', devMode: false })
    })
    expect(result.warnings).toEqual([])
    expect(
      result.files.has(`src/__openpencil_markdown.${target === 'react' ? 'tsx' : 'vue'}`)
    ).toBe(true)
    const files = new Map<string, string>()
    for (const [path, value] of result.files) if (typeof value === 'string') files.set(path, value)
    files.set(
      `src/__openpencil_markdown.${target === 'react' ? 'tsx' : 'vue'}`,
      target === 'react' ? buildOpenPencilMarkdownComponent() : buildOpenPencilVueMarkdown()
    )
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  }, 35000)
}
