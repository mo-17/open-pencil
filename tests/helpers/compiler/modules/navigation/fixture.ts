import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createBreadcrumbModuleFrameOverrides,
  createStepperModuleFrameOverrides
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function navigationFixture(target: 'react' | 'vue') {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const items = [
    { title: '账户资料', description: '提供基本信息', status: 'auto', disabled: false },
    { title: '核对信息', description: '<b>纯文本</b>', status: 'auto', disabled: false },
    { title: '无法选择', description: '该步骤已禁用', status: 'error', disabled: true }
  ]
  for (const [index, orientation] of ['horizontal', 'vertical'].entries()) {
    graph.createNode('FRAME', page.id, {
      ...createStepperModuleFrameOverrides({
        label: orientation,
        items:
          index === 0
            ? items
            : items.map((item, itemIndex) => ({
                ...item,
                description:
                  itemIndex === 0 ? '核对完整的账户资料与地址信息。'.repeat(8) : item.description
              })),
        fontSize: index === 0 ? 14 : 32,
        currentIndex: 0,
        orientation,
        allowStepClick: index === 0
      }),
      x: 20,
      y: 20 + index * 140,
      width: index === 0 ? 320 : 480,
      height: index === 0 ? 130 : 320
    })
  }
  graph.createNode('FRAME', page.id, {
    ...createBreadcrumbModuleFrameOverrides({
      label: '导航路径',
      wrap: false,
      items: [
        { label: '首页', href: '#home' },
        { label: '很长的中文目录名称'.repeat(4), href: '' },
        { label: '当前页面', href: 'https://example.com/' }
      ]
    }),
    x: 20,
    y: 500,
    width: 300,
    height: 150
  })
  graph.createNode('FRAME', page.id, {
    ...createStepperModuleFrameOverrides({
      label: 'Many steps',
      currentIndex: 0,
      items: [...items, { title: '完成', description: '完成设置', status: 'auto', disabled: false }]
    }),
    x: 20,
    y: 670,
    width: 320,
    height: 130
  })
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
}
