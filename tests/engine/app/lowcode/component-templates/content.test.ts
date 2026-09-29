import { expect, test } from 'bun:test'

import { resolveCodeBlockModule, resolveMarkdownModule } from '@open-pencil/core/plugins'

import { getComponentTemplates } from '@/app/lowcode/component-templates'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

for (const locale of ['zh-CN', 'en']) {
  test(`${locale} content recipes remain editable inert FRAME modules`, () => {
    const templates = getComponentTemplates(locale).filter((item) =>
      ['markdown-note', 'markdown-table', 'code-block'].includes(item.id)
    )
    expect(templates).toHaveLength(3)
    for (const template of templates) {
      const type = template.id === 'code-block' ? 'code-block' : 'markdown'
      expect(template.kind).toBe('basic')
      expect(template.requiredModules).toEqual([
        { pluginId: 'open-pencil.' + type, moduleType: type }
      ])
      const { editor, graph } = componentTemplateFixture([template.id], locale)
      try {
        const node = [...graph.getAllNodes()].find((entry) => entry.interactiveProps?.module)
        expect(node?.type).toBe('FRAME')
        expect(node?.interactiveProps?.lang).toBe(locale)
        expect(node?.bindings ?? []).toEqual([])
        expect(node?.events ?? []).toEqual([])
        const instance = node?.interactiveProps?.module
        if (type === 'code-block') {
          const resolved = resolveCodeBlockModule(instance)
          if (!resolved?.ok) throw new Error('Missing code template')
          expect(resolved.config).toMatchObject({
            wrapLines: true,
            showLineNumbers: true,
            showCopyButton: true
          })
          expect(resolved.config.code).toContain('console.log(message)')
          expect(resolved.config.code.includes('你好')).toBe(locale === 'zh-CN')
        } else {
          const resolved = resolveMarkdownModule(instance)
          if (!resolved?.ok) throw new Error('Missing Markdown template')
          expect(resolved.config.flavor).toBe('gfm')
          expect(resolved.config.source.includes('## 项目清单')).toBe(
            locale === 'zh-CN' && template.id === 'markdown-table'
          )
          expect(resolved.config.source).not.toContain('https://')
          if (template.id === 'markdown-table') expect(resolved.config.source).toContain('- [x]')
        }
      } finally {
        editor.dispose()
      }
    }
  })
}
