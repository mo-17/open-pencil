import { compile, withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'

import { getComponentTemplates } from '@/app/lowcode/component-templates'
import { createComponentTemplate } from '@/app/lowcode/component-templates/build'

export type TemplateId = Parameters<typeof createComponentTemplate>[1]
export type TemplateTarget = 'react' | 'vue'

export function componentTemplateFixture(ids?: readonly TemplateId[], locale = 'en') {
  const editor = createEditor()
  const pageId = editor.state.currentPageId
  const selectedIds = ids ?? getComponentTemplates(locale).map((item) => item.id)
  const results = selectedIds.map((id, index) =>
    createComponentTemplate(editor, id, locale, { parentId: pageId, x: 0, y: index * 900 })
  )
  return { editor, graph: editor.graph, pageId, results }
}

export function compileComponentTemplates(
  target: TemplateTarget,
  ids?: readonly TemplateId[],
  locale = 'en'
) {
  const { editor, graph, pageId } = componentTemplateFixture(ids, locale)
  try {
    return compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({
        target,
        devMode: false,
        sourceLocale: locale,
        packageName: 'component-template-library',
        router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
      })
    })
  } finally {
    editor.dispose()
  }
}
