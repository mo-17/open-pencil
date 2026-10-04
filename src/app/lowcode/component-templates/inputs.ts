import {
  DATE_RANGE_MODULE_DEFINITION,
  POPOVER_MODULE_DEFINITION,
  TREE_MODULE_DEFINITION
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import { TEMPLATE_COLORS, type TemplateContext } from './presentation'

export type InputTemplateId =
  | 'multi-select'
  | 'date-range'
  | 'tree'
  | 'tree-select'
  | 'popover'
  | 'popconfirm'
const IDS: ReadonlySet<string> = new Set<InputTemplateId>([
  'multi-select',
  'date-range',
  'tree',
  'tree-select',
  'popover',
  'popconfirm'
])
export function isInputTemplateId(id: string): id is InputTemplateId {
  return IDS.has(id)
}

function addMultipleSelect(ctx: TemplateContext, parent: string): void {
  const choices = ctx.localState('choices', 'array', ['design'])
  ctx.field(parent, 'SELECT', ctx.copy('Project interests', '项目方向'), choices, {
    multiple: true,
    showSearch: true,
    allowClear: true,
    virtual: true,
    placeholder: ctx.copy('Choose one or more', '选择一个或多个方向'),
    options: [
      { label: ctx.copy('Design', '设计'), value: 'design' },
      { label: ctx.copy('Development', '开发'), value: 'development' },
      { label: ctx.copy('Research', '研究'), value: 'research' },
      { label: ctx.copy('Archived', '已归档'), value: 'archived', disabled: true }
    ]
  })
  ctx.feedback(parent, choices, ctx.copy('Selected values', '已选值'))
}
function treeFrame(ctx: TemplateContext, id: 'tree' | 'tree-select'): Partial<SceneNode> {
  const { copy } = ctx
  return TREE_MODULE_DEFINITION.createFrameOverrides({
    presentation: id === 'tree' ? 'tree' : 'select',
    label: copy('Project structure', '项目结构'),
    placeholder: copy('Choose a project item', '选择项目条目'),
    items: [
      { id: 'project', parentId: '', label: copy('Project', '项目'), disabled: false },
      { id: 'design', parentId: 'project', label: copy('Design', '设计'), disabled: false },
      {
        id: 'development',
        parentId: 'project',
        label: copy('Development', '开发'),
        disabled: false
      },
      { id: 'research', parentId: 'project', label: copy('Research', '研究'), disabled: false },
      { id: 'archive', parentId: '', label: copy('Archive', '归档'), disabled: true }
    ],
    selectionMode: id === 'tree' ? 'multiple' : 'single',
    initialSelectedIds: ['design'],
    initialExpandedIds: ['project'],
    backgroundColor: TEMPLATE_COLORS.paper,
    textColor: TEMPLATE_COLORS.ink,
    accentColor: TEMPLATE_COLORS.accent
  })
}
function inputFrame(
  ctx: TemplateContext,
  id: Exclude<InputTemplateId, 'multi-select'>
): Partial<SceneNode> {
  const { copy } = ctx
  if (id === 'tree' || id === 'tree-select') return treeFrame(ctx, id)
  if (id === 'date-range')
    return DATE_RANGE_MODULE_DEFINITION.createFrameOverrides({
      label: copy('Travel dates', '出行日期'),
      initialStart: '2026-09-01',
      initialEnd: '2026-09-05',
      min: '2020-01-01',
      max: '2099-12-31',
      backgroundColor: TEMPLATE_COLORS.paper,
      textColor: TEMPLATE_COLORS.ink,
      accentColor: TEMPLATE_COLORS.accent
    })
  const confirmation = id === 'popconfirm'
  return POPOVER_MODULE_DEFINITION.createFrameOverrides({
    mode: confirmation ? 'confirm' : 'popover',
    triggerLabel: confirmation
      ? copy('Review this choice', '确认此选择')
      : copy('View project details', '查看项目详情'),
    title: confirmation
      ? copy('Confirm this local example?', '确认此本地示例？')
      : copy('Project details', '项目详情'),
    content: confirmation
      ? copy(
          'Confirm or cancel to see local feedback. No data will be saved or deleted.',
          '确认或取消以查看本地反馈，不会保存或删除数据。'
        )
      : copy(
          'Edit this text in the design panel, or map your own content layer. Press Escape to return to the trigger.',
          '在设计面板编辑这些文字，或映射自己的内容图层。按 Escape 返回触发按钮。'
        ),
    confirmLabel: copy('Confirm', '确认'),
    cancelLabel: copy('Cancel', '取消'),
    placement: 'bottom',
    panelWidth: 280
  })
}
export function addInputTemplate(ctx: TemplateContext, parent: string, id: InputTemplateId): void {
  if (id === 'multi-select') {
    addMultipleSelect(ctx, parent)
    return
  }
  const frame = inputFrame(ctx, id)
  const start =
    id === 'date-range' ? ctx.localState('startDate', 'string', '2026-09-01') : undefined
  const end = id === 'date-range' ? ctx.localState('endDate', 'string', '2026-09-05') : undefined
  const treeValue =
    id === 'tree' || id === 'tree-select'
      ? ctx.localState(
          'treeSelection',
          id === 'tree' ? 'array' : 'string',
          id === 'tree' ? ['design'] : 'design'
        )
      : undefined
  if (start && end)
    frame.bindings = {
      value: { kind: 'ref', stateId: start },
      endValue: { kind: 'ref', stateId: end }
    }
  if (treeValue) frame.bindings = { value: { kind: 'ref', stateId: treeValue } }
  ctx.node('FRAME', parent, frame.name ?? id, {
    ...frame,
    counterAxisSizing: 'FILL',
    textLanguage: ctx.zh ? 'zh-CN' : 'en',
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
  if (start) ctx.feedback(parent, start, ctx.copy('Start date', '开始日期'))
  if (end) ctx.feedback(parent, end, ctx.copy('End date', '结束日期'))
  if (treeValue) ctx.feedback(parent, treeValue, ctx.copy('Selected node IDs', '已选节点 ID'))
}
