import { createPaginationModuleFrameOverrides } from '@open-pencil/core/plugins'

import { TEMPLATE_COLORS, templateSurface, type TemplateContext } from './presentation'

function pagination(ctx: TemplateContext, root: string, page: string, total: string, size: string) {
  return ctx.node('FRAME', root, ctx.copy('Page controls', '分页控件'), {
    ...createPaginationModuleFrameOverrides({
      label: ctx.copy('Browse pages', '浏览分页'),
      total: 12,
      pageSize: 3,
      size: 'compact',
      textColor: TEMPLATE_COLORS.ink,
      accentColor: TEMPLATE_COLORS.accent,
      borderColor: TEMPLATE_COLORS.border
    }),
    width: 320,
    height: 48,
    counterAxisSizing: 'FILL',
    bindings: {
      currentPage: { kind: 'ref', stateId: page },
      total: { kind: 'expr', expr: total },
      pageSize: { kind: 'ref', stateId: size }
    }
  })
}

export function addPaginationTemplate(ctx: TemplateContext, root: string): void {
  const page = ctx.localState('page', 'number', 1)
  const total = ctx.localState('total', 'number', 12)
  const size = ctx.localState('pageSize', 'number', 3)
  pagination(ctx, root, page, total, size)
  ctx.feedback(root, page, ctx.copy('Current page', '当前页'))
  ctx.text(root, ctx.copy('12 items · 3 items per page', '共 12 条 · 每页 3 条'), { fontSize: 12 })
}

export function addPaginatedListTemplate(ctx: TemplateContext, root: string): void {
  const page = ctx.localState('page', 'number', 1)
  const size = ctx.localState('pageSize', 'number', 3)
  const records = ctx.localState(
    'records',
    'array',
    Array.from({ length: 12 }, (_, index) => ({
      title: ctx.copy('Record ', '记录 ') + (index + 1),
      detail: ctx.copy('Editable local sample', '可编辑的本地示例')
    }))
  )
  const list = ctx.node('LIST', root, ctx.copy('Local records', '本地记录'), {
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisAlign: 'STRETCH',
    itemSpacing: 10,
    interactiveProps: {
      dataSourceRef: { kind: 'stateRef', stateId: records },
      itemName: 'record',
      indexName: 'recordIndex'
    }
  })
  // The expression language has no function calls. Derive ceil(total / size)
  // with integer remainder and clamp the view without mutating authored state.
  const count = `((${records}.length - ${records}.length % ${size}) / ${size} + (${records}.length % ${size} > 0 ? 1 : 0))`
  const effective = `(${page} < 1 ? 1 : ${page} > ${count} ? ${count} : ${page})`
  const row = ctx.stack(list, ctx.copy('Record row', '记录行'), {
    ...templateSurface(TEMPLATE_COLORS.tint),
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    itemSpacing: 4,
    renderCondition: `recordIndex >= (${effective} - 1) * ${size} && recordIndex < ${effective} * ${size}`
  })
  ctx.text(row, ctx.copy('Record 1', '记录 1'), {
    fontWeight: 600,
    bindings: { text: { kind: 'expr', expr: 'record.title' } }
  })
  ctx.text(row, ctx.copy('Editable local sample', '可编辑的本地示例'), {
    fontSize: 12,
    bindings: { text: { kind: 'expr', expr: 'record.detail' } }
  })
  pagination(ctx, root, page, `${records}.length`, size)
  ctx.feedback(root, page, ctx.copy('Current page', '当前页'))
}
