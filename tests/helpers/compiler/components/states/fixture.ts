import { compile, withDefaults } from '@open-pencil/compiler'
import { computeAllLayouts } from '@open-pencil/core/layout'
import {
  createCascaderModuleFrameOverrides,
  createDateRangeModuleFrameOverrides,
  createRatingModuleFrameOverrides,
  createRichTextModuleFrameOverrides,
  createSliderModuleFrameOverrides,
  createStepperModuleFrameOverrides,
  createTreeModuleFrameOverrides
} from '@open-pencil/core/plugins'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { CONTROL_STATES, type CanvasStateFamily, type StateFamily, type StateLocale } from './types'

function moduleFrame(family: StateFamily, zh: boolean): Partial<SceneNode> {
  const label = zh
    ? '保留当前选择并完整显示说明文字'
    : 'Keep the current selection and readable labels'
  if (family === 'slider' || family === 'range')
    return createSliderModuleFrameOverrides({
      label,
      range: family === 'range',
      initialValue: 30,
      initialEndValue: 70
    })
  if (family === 'rating') return createRatingModuleFrameOverrides({ label, initialValue: 3 })
  if (family === 'date-range')
    return createDateRangeModuleFrameOverrides({
      label,
      initialStart: '2026-09-01',
      initialEnd: '2026-09-30'
    })
  if (family === 'cascader')
    return createCascaderModuleFrameOverrides({ label, initialPath: ['asia', 'china', 'xiamen'] })
  if (family === 'stepper')
    return createStepperModuleFrameOverrides({
      label,
      allowStepClick: true,
      currentIndex: 1,
      items: [
        {
          title: zh ? '填写资料' : 'Details',
          description: zh
            ? '长说明文字应换行且保持在容器内'
            : 'Long descriptions must stay inside the authored surface',
          status: 'auto',
          disabled: false
        },
        {
          title: zh ? '检查内容' : 'Review',
          description: zh ? '只读仍可阅读' : 'Read-only stays readable',
          status: 'auto',
          disabled: false
        },
        {
          title: zh ? '暂不可用' : 'Blocked',
          description: zh ? '禁用步骤' : 'Disabled step',
          status: 'auto',
          disabled: true
        },
        {
          title: zh ? '错误状态' : 'Error',
          description: zh ? '保留明确错误' : 'Keep explicit errors',
          status: 'error',
          disabled: false
        }
      ]
    })
  return treeFrame(family, label, zh)
}

function treeFrame(family: StateFamily, label: string, zh: boolean): Partial<SceneNode> {
  return createTreeModuleFrameOverrides({
    presentation: family === 'tree-select' ? 'select' : 'tree',
    label,
    initialSelectedIds: ['design'],
    initialExpandedIds: ['project'],
    items: [
      { id: 'project', label: zh ? '项目文件' : 'Project files', parentId: '', disabled: false },
      {
        id: 'design',
        label: zh ? '设计资料与较长的分类说明' : 'Design resources with a long category label',
        parentId: 'project',
        disabled: false
      },
      {
        id: 'development',
        label: zh ? '开发文档' : 'Development',
        parentId: 'project',
        disabled: false
      },
      {
        id: 'archive',
        label: zh ? '归档（禁用）' : 'Archive (disabled)',
        parentId: '',
        disabled: true
      }
    ]
  })
}

/** The same public authored graph is used for FIG, Canvas and both compiler targets. */
export function componentStateGraph(family: StateFamily, locale: StateLocale = 'en') {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const zh = locale === 'zh-CN'
  const controlHeight = Math.max(144, moduleFrame(family, zh).height ?? 144) + 40
  const root = graph.createNode('FRAME', pageId, {
    name: family + ' states',
    width: 352,
    height: (controlHeight + 44) * 3 + 32,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: 12,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    cornerRadius: 12,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
  })
  const controls = CONTROL_STATES.map((state) => {
    graph.createNode('TEXT', root.id, {
      name: state,
      text: `${family} · ${zh ? { normal: '正常', disabled: '禁用', readonly: '只读' }[state] : state}`,
      width: 320,
      height: 24,
      fontSize: 16,
      fontFamily: 'R5 Missing Font',
      fills: [
        { type: 'SOLID', color: { r: 0.09, g: 0.17, b: 0.3, a: 1 }, opacity: 1, visible: true }
      ]
    })
    const frame = moduleFrame(family, zh)
    const node = graph.createNode('FRAME', root.id, {
      ...frame,
      name: `${family} ${state}`,
      width: 320,
      height: controlHeight,
      cornerRadius: 8,
      interactiveProps: {
        ...frame.interactiveProps,
        lang: locale,
        disabled: state === 'disabled',
        readOnly: state === 'readonly'
      }
    })
    return { state, id: node.id }
  })
  computeAllLayouts(graph)
  return { graph, pageId, rootId: root.id, controls }
}

export function richTextTypographyGraph(locale: StateLocale = 'en') {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const root = graph.createNode('FRAME', pageId, {
    name: 'rich-text typography',
    width: 352,
    height: 360,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: 12,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
  })
  for (const fontSize of [16, 32]) {
    graph.createNode('TEXT', root.id, {
      text: `${fontSize}px`,
      width: 320,
      height: 24,
      fontFamily: 'R5 Missing Font',
      fontSize: 16,
      fills: [
        { type: 'SOLID', color: { r: 0.09, g: 0.17, b: 0.3, a: 1 }, opacity: 1, visible: true }
      ]
    })
    graph.createNode('FRAME', root.id, {
      ...createRichTextModuleFrameOverrides({
        fontSize,
        lineHeight: 1.5,
        content: {
          type: 'doc',
          blocks: [
            {
              type: 'paragraph',
              align: 'left',
              children: [
                {
                  type: 'text',
                  text:
                    locale === 'zh-CN'
                      ? '中文字号与字体回退 Font size fallback'
                      : 'Readable font size and fallback',
                  marks: []
                }
              ]
            }
          ]
        }
      }),
      width: 320,
      height: Math.max(256, fontSize * 12),
      name: `rich-text ${fontSize}px`
    })
  }
  computeAllLayouts(graph)
  return { graph, pageId, rootId: root.id }
}

export function compileComponentStates(
  target: 'react' | 'vue',
  family: CanvasStateFamily,
  locale: StateLocale = 'en'
) {
  const { graph, pageId } =
    family === 'rich-text' ? richTextTypographyGraph(locale) : componentStateGraph(family, locale)
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      devMode: false,
      sourceLocale: locale,
      packageName: 'component-states'
    })
  })
}
