import { compile, withDefaults } from '@open-pencil/compiler'
import { createWalktourModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function walktourGraph() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [{ id: 'show', name: 'show', type: 'boolean', defaultValue: false }]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'rows', name: 'rows', type: 'array', defaultValue: ['Alpha', 'Beta'] },
      { id: 'field', name: 'field', type: 'string', defaultValue: '' }
    ]
  })
  const main = graph.createNode('FRAME', page.id, {
    ...createWalktourModuleFrameOverrides({
      triggerLabel: 'Start guide',
      steps: [
        {
          id: 'intro',
          title: 'Overview',
          content: 'Read the guide without changing any data.',
          targetChildName: '',
          placement: 'bottom'
        },
        {
          id: 'profile',
          title: 'Profile step',
          content: 'This card is an ordinary child layer.',
          targetChildName: 'Profile',
          placement: 'right'
        },
        {
          id: 'hidden',
          title: 'Hidden step',
          content: 'Still available to read.',
          targetChildName: 'Conditional',
          placement: 'top'
        },
        {
          id: 'rows',
          title: 'Rows step',
          content: 'These rows remain mounted.',
          targetChildName: 'Rows',
          placement: 'bottom'
        }
      ]
    }),
    width: 320,
    height: 420,
    name: 'Guide',
    x: 12,
    y: 12
  })
  const profile = graph.createNode('TEXT', main.id, {
    name: 'Profile',
    x: 16,
    y: 64,
    width: 288,
    height: 70,
    text: 'Profile card',
    fontSize: 16
  })
  const conditional = graph.createNode('TEXT', main.id, {
    name: 'Conditional',
    x: 16,
    y: 150,
    width: 288,
    height: 60,
    text: 'Conditional card',
    renderCondition: 'show'
  })
  const list = graph.createNode('LIST', main.id, {
    name: 'Rows',
    x: 16,
    y: 240,
    width: 288,
    height: 100,
    layoutMode: 'VERTICAL',
    interactiveProps: {
      dataSourceRef: { kind: 'docStateRef', docStateName: 'rows' },
      itemName: 'row'
    }
  })
  graph.createNode('TEXT', list.id, { width: 270, height: 32, text: `Row: \${row}` })
  const extra = graph.createNode('TEXT', main.id, {
    name: 'Unmapped',
    x: 16,
    y: 360,
    width: 288,
    height: 32,
    text: 'Unmapped stays visible'
  })
  graph.createNode('TEXT', page.id, {
    name: 'Conditional',
    x: 12,
    y: 460,
    width: 300,
    height: 30,
    text: 'Outside module must not become a target'
  })
  return { graph, page, main, profile, conditional, list, extra }
}
export function walktourFixture(target: 'react' | 'vue') {
  const { graph, page } = walktourGraph()
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false, sourceLocale: 'en' })
  })
}

export function walktourFormFixture(target: 'react' | 'vue') {
  const { graph, page, main, profile, extra } = walktourGraph()
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      ...(graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []),
      ...['mappedDraft', 'unmappedDraft', 'otherDraft'].map((name) => ({
        id: name,
        name,
        type: 'string' as const,
        defaultValue: ''
      })),
      { id: 'guideSubmits', name: 'guideSubmits', type: 'number', defaultValue: 0 }
    ]
  })
  const form = graph.createNode('FORM', page.id, {
    width: 340,
    height: 540,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    events: {
      onSubmit: [
        {
          id: 'submit-guide',
          kind: 'setVariable',
          targetName: 'guideSubmits',
          valueExpr: '$prev + 1'
        }
      ]
    }
  })
  graph.reparentNode(main.id, form.id)
  graph.updateNode(main.id, { x: 0, y: 0 })
  graph.updateNode(profile.id, { type: 'FRAME' })
  graph.updateNode(extra.id, { visible: false })
  const field = (parent: string, name: string, label: string, y = 0) =>
    graph.createNode('INPUT', parent, {
      width: 288,
      height: 44,
      y,
      bindings: { value: { kind: 'docState', docStateName: name } },
      interactiveProps: {
        placeholder: label,
        validation: { required: true, messages: { required: label + ' required' } }
      }
    })
  field(profile.id, 'mappedDraft', 'Mapped guide field')
  field(main.id, 'unmappedDraft', 'Unmapped guide field', 360)
  for (const type of ['submit', 'reset'] as const)
    graph.createNode('BUTTON', form.id, {
      width: 200,
      height: 44,
      interactiveProps: { text: type === 'submit' ? 'Submit guide' : 'Reset guide', type }
    })
  const other = graph.createNode('FORM', page.id, { x: 0, y: 560, width: 340, height: 60 })
  field(other.id, 'otherDraft', 'Separate field')
  graph.createNode('TEXT', page.id, {
    x: 0,
    y: 640,
    width: 340,
    height: 32,
    text: `Guide submits \${guideSubmits}`
  })
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false, sourceLocale: 'en' })
  })
}
