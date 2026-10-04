import { TREE_MODULE_DEFINITION } from '@open-pencil/core/plugins'

import { TEMPLATE_COLORS, templateSurface, type TemplateContext } from '../presentation'

function categoryDetails(ctx: TemplateContext) {
  const { copy } = ctx
  return [
    {
      id: 'project',
      title: copy('Project overview', '项目概览'),
      description: copy(
        'Select a category to inspect its local example details.',
        '选择分类，查看对应的本地示例详情。'
      )
    },
    {
      id: 'design',
      title: copy('Design', '设计'),
      description: copy(
        'Review layouts, components and visual specifications.',
        '查看布局、组件与视觉规范。'
      )
    },
    {
      id: 'development',
      title: copy('Development', '开发'),
      description: copy(
        'Review implementation tasks and integration notes.',
        '查看实现任务与集成说明。'
      )
    },
    {
      id: 'research',
      title: copy('Research', '研究'),
      description: copy('Review interview notes and product questions.', '查看访谈记录与产品问题。')
    }
  ]
}

function detailExpression(
  selected: string,
  rows: ReturnType<typeof categoryDetails>,
  field: 'title' | 'description'
): string {
  return rows.reduceRight(
    (fallback, row) =>
      `${selected} === ${JSON.stringify(row.id)} ? ${JSON.stringify(row[field])} : (${fallback})`,
    '""'
  )
}

/** Single selection projects authored details through ordinary editable TEXT bindings. */
export function addTreeDetailsTemplate(ctx: TemplateContext, root: string): void {
  const { copy } = ctx
  const selected = ctx.localState('category', 'string', 'design')
  const rows = categoryDetails(ctx)
  const available = rows.map((row) => `${selected} === ${JSON.stringify(row.id)}`).join(' || ')
  const frame = TREE_MODULE_DEFINITION.createFrameOverrides({
    presentation: 'tree',
    selectionMode: 'single',
    label: copy('Project categories', '项目分类'),
    items: [
      { id: 'project', parentId: '', label: copy('Project', '项目'), disabled: false },
      ...rows.slice(1).map((row) => ({
        id: row.id,
        parentId: 'project',
        label: row.title,
        disabled: false
      })),
      { id: 'archive', parentId: '', label: copy('Archive', '归档'), disabled: true }
    ],
    initialSelectedIds: ['design'],
    initialExpandedIds: ['project'],
    searchable: true,
    backgroundColor: TEMPLATE_COLORS.paper,
    textColor: TEMPLATE_COLORS.ink,
    accentColor: TEMPLATE_COLORS.accent
  })
  ctx.node('FRAME', root, copy('Category tree', '分类树'), {
    ...frame,
    counterAxisSizing: 'FILL',
    bindings: { value: { kind: 'ref', stateId: selected } },
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
  const details = ctx.stack(root, copy('Category details', '分类详情'), {
    ...templateSurface(TEMPLATE_COLORS.tint),
    paddingTop: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    paddingRight: 16,
    renderCondition: available
  })
  ctx.text(details, copy('Design', '设计'), {
    fontSize: 20,
    fontWeight: 600,
    bindings: { text: { kind: 'expr', expr: detailExpression(selected, rows, 'title') } }
  })
  ctx.text(details, rows[1]?.description ?? '', {
    bindings: { text: { kind: 'expr', expr: detailExpression(selected, rows, 'description') } }
  })
  ctx.feedback(details, selected, copy('Category ID', '分类 ID'))
  const empty = ctx.stack(root, copy('No category selected', '尚未选择分类'), {
    renderCondition: `${selected} === ""`
  })
  ctx.text(empty, copy('Choose a category to view details.', '选择分类后查看详情。'))
  ctx.text(root, copy('The selected category is unavailable.', '当前分类不可用。'), {
    renderCondition: `${selected} !== "" && !(${available})`
  })
  ctx.button(root, copy('Clear selection', '清空选择'), [ctx.set(selected, '""')], true)
  ctx.text(
    root,
    copy(
      'Search and expand local categories. Details are editable examples; Archive is unavailable.',
      '搜索与展开本地分类。详情为可编辑示例；归档项不可选。'
    ),
    { fontSize: 12 }
  )
}
