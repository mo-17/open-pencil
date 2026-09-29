import { addAdvancedInputTemplate, isAdvancedInputTemplateId } from './advanced-fields'
import { addCascaderTemplate } from './cascader'
import type { ComponentTemplateId } from './catalog'
import { addChartTemplate, isChartTemplateId } from './charts'
import { addContentTemplate, isContentTemplateId } from './content'
import { addTemplateControl, isControlTemplateId } from './controls'
import { addDisplayTemplate, isDisplayTemplateId } from './display'
import { addFeedbackTemplate, isFeedbackTemplateId } from './feedback'
import { addBoundInputTemplate } from './fields'
import { addFoundationTemplate, isFoundationTemplateId } from './foundations'
import { addInputTemplate, isInputTemplateId } from './inputs'
import { addTemplateGrid, addTemplateUpload } from './modules'
import { addOrgChartTemplate } from './org-chart'
import { addPaginationTemplate } from './pagination'
import { addPickerTemplate } from './pickers'
import { TEMPLATE_COLORS, templateSurface, type TemplateContext } from './presentation'
import { addWalktourTemplate } from './walktour'

export function buildBasicTemplate(
  ctx: TemplateContext,
  root: string,
  id: ComponentTemplateId
): boolean {
  if (id === 'pagination') {
    addPaginationTemplate(ctx, root)
    return true
  }
  if (buildModuleTemplate(ctx, root, id)) return true
  const { copy, state, field, feedback } = ctx
  switch (id) {
    case 'button': {
      const counter = state('clicks', 'number', 0)
      ctx.button(root, copy('Add one', '加一'), [ctx.set(counter, '$prev + 1')])
      feedback(root, counter, copy('Clicks', '点击次数'))
      return true
    }
    case 'input':
    case 'textarea': {
      const value = state('value', 'string', '')
      field(root, id === 'input' ? 'INPUT' : 'TEXTAREA', copy('Your text', '输入内容'), value, {
        placeholder: copy('Type here', '在此输入'),
        maxLength: id === 'input' ? 80 : 240,
        autoComplete: 'off'
      })
      feedback(root, value)
      return true
    }
    case 'autocomplete':
    case 'time-picker':
      addBoundInputTemplate(ctx, root, id)
      return true
    case 'select': {
      const value = state('delivery', 'string', 'standard')
      field(root, 'SELECT', copy('Delivery', '配送方式'), value, {
        options: [
          { label: copy('Standard', '标准配送'), value: 'standard' },
          { label: copy('Express', '加急配送'), value: 'express' },
          { label: copy('Unavailable', '暂不可用'), value: 'unavailable', disabled: true }
        ]
      })
      feedback(root, value)
      return true
    }
    case 'checkbox':
    case 'switch': {
      const value = state('enabled', 'boolean', false)
      field(
        root,
        id === 'checkbox' ? 'CHECKBOX' : 'SWITCH',
        copy('Enable option', '启用选项'),
        value
      )
      feedback(
        root,
        `${value} ? ${JSON.stringify(copy('On', '已启用'))} : ${JSON.stringify(copy('Off', '未启用'))}`
      )
      return true
    }
    case 'radio': {
      const value = state('plan', 'string', copy('Personal', '个人'))
      field(root, 'RADIO', copy('Plan', '方案'), value, {
        groupName: ctx.prefix + '_plan',
        options: [copy('Personal', '个人'), copy('Team', '团队')]
      })
      feedback(root, value)
      return true
    }
    case 'datepicker': {
      const value = state('date', 'string', '2026-09-22')
      field(root, 'DATEPICKER', copy('Date', '日期'), value, {
        min: '2020-01-01',
        max: '2099-12-31'
      })
      feedback(root, value)
      return true
    }
    case 'card': {
      const card = ctx.stack(root, copy('Card content', '卡片内容'), {
        ...templateSurface(TEMPLATE_COLORS.tint),
        paddingTop: 20,
        paddingRight: 20,
        paddingBottom: 20,
        paddingLeft: 20
      })
      ctx.text(card, copy('A clear starting point', '清晰的起点'), {
        fontSize: 20,
        fontWeight: 600
      })
      ctx.text(
        card,
        copy(
          'Replace these layers with your own content. Spacing follows the layout.',
          '替换为自己的内容，间距随自动布局调整。'
        )
      )
      ctx.text(card, copy('Editable layers · no remote assets', '可编辑图层 · 无远程素材'), {
        fontSize: 12
      })
      return true
    }
    case 'divider':
      ctx.text(root, copy('Section heading', '分区标题'), { fontSize: 18, fontWeight: 600 })
      ctx.node('RECTANGLE', root, copy('Divider', '分隔线'), {
        ...templateSurface(TEMPLATE_COLORS.border),
        cornerRadius: 0,
        height: 1
      })
      ctx.text(
        root,
        copy('Group related information under this heading.', '在此标题下组织相关信息。')
      )
      return true
    case 'upload':
      addTemplateUpload(ctx, root)
      return true
    case 'data-grid':
      addTemplateGrid(ctx, root)
      return true
    default:
      return false
  }
}

function buildModuleTemplate(ctx: TemplateContext, root: string, id: ComponentTemplateId): boolean {
  if (id === 'cascader') {
    addCascaderTemplate(ctx, root)
    return true
  }
  if (id === 'walktour') {
    addWalktourTemplate(ctx, root)
    return true
  }
  if (id === 'org-chart') {
    addOrgChartTemplate(ctx, root)
    return true
  }
  if (id === 'color-picker' || id === 'descriptions') {
    addPickerTemplate(ctx, root, id)
    return true
  }
  if (isAdvancedInputTemplateId(id)) {
    addAdvancedInputTemplate(ctx, root, id)
    return true
  }
  if (isInputTemplateId(id)) {
    addInputTemplate(ctx, root, id)
    return true
  }
  if (isChartTemplateId(id)) {
    addChartTemplate(ctx, root, id)
    return true
  }
  if (isControlTemplateId(id)) {
    addTemplateControl(ctx, root, id)
    return true
  }
  if (isContentTemplateId(id)) {
    addContentTemplate(ctx, root, id)
    return true
  }
  if (isFeedbackTemplateId(id)) {
    addFeedbackTemplate(ctx, root, id)
    return true
  }
  if (isDisplayTemplateId(id)) {
    addDisplayTemplate(ctx, root, id)
    return true
  }
  if (isFoundationTemplateId(id)) {
    addFoundationTemplate(ctx, root, id)
    return true
  }
  return false
}
