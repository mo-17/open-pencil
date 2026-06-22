import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/core'

function compileApp(graph: SceneGraph, pageId: string, uiKit?: 'shadcn'): string {
  const out = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'options-source', ...(uiKit ? { uiKit } : {}) })
  })
  return out.files.get('src/App.tsx') as string
}

describe('compile — dynamic control options (Phase 4 §17.4)', () => {
  test('SELECT maps docState array options into plain <option> rows', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        {
          id: 'd-countries',
          name: 'countries',
          type: 'array',
          defaultValue: [
            { code: 'US', name: 'United States' },
            { code: 'CN', name: 'China' }
          ]
        },
        { id: 'd-country', name: 'country', type: 'string', defaultValue: '' }
      ]
    })
    graph.createNode('SELECT', page.id, {
      interactiveProps: {
        optionsSource: {
          kind: 'docStateRef',
          docStateName: 'countries',
          itemName: 'countryOption',
          valueExpr: 'countryOption.code',
          labelExpr: 'countryOption.name'
        }
      },
      bindings: { value: { kind: 'docState', docStateName: 'country' } }
    })

    const app = compileApp(graph, page.id)

    expect(app).toContain('const countries = useDocState("countries")')
    expect(app).toContain('{(countries).map((countryOption, index) => (')
    expect(app).toMatch(
      /<option key={index}[^>]*value={countryOption\.code}>{countryOption\.name}<\/option>/
    )
    expect(app).toContain('value={country}')
    expect(app).toContain('onChange={(e) => setDocState("country", e.target.value)}')
  })

  test('RADIO maps page-state array options into controlled dynamic radio rows', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [
        {
          id: 's-plans',
          name: 'plans',
          type: 'array',
          defaultValue: [
            { id: 'free', label: 'Free' },
            { id: 'pro', label: 'Pro' }
          ]
        },
        { id: 's-plan', name: 'plan', type: 'string', defaultValue: '' }
      ]
    })
    graph.createNode('RADIO', page.id, {
      interactiveProps: {
        groupName: 'plan',
        optionsSource: {
          kind: 'ref',
          stateId: 's-plans',
          itemName: 'planOption',
          valueExpr: 'planOption.id',
          labelExpr: 'planOption.label'
        }
      },
      bindings: { value: { kind: 'ref', stateId: 's-plan' } }
    })

    const app = compileApp(graph, page.id)

    expect(app).toContain('{(plans).map((planOption, index) => (')
    expect(app).toContain('type="radio" value={planOption.id} name="plan"')
    expect(app).toContain('checked={plan === planOption.id}')
    expect(app).toContain('onChange={(e) => setPlan(e.target.value)}')
    expect(app).toContain('{planOption.label}')
  })

  test('CHECKBOX group maps dynamic options into array includes/toggle rows', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [
        { id: 's-tags', name: 'tags', type: 'array', defaultValue: [] },
        { id: 's-picked', name: 'pickedTags', type: 'array', defaultValue: [] }
      ]
    })
    graph.createNode('CHECKBOX', page.id, {
      interactiveProps: {
        optionsSource: {
          kind: 'ref',
          stateId: 's-tags',
          itemName: 'tag',
          valueExpr: 'tag.id',
          labelExpr: 'tag.name'
        }
      },
      bindings: { value: { kind: 'ref', stateId: 's-picked' } }
    })

    const app = compileApp(graph, page.id)

    expect(app).toContain('{(tags).map((tag, index) => (')
    expect(app).toContain('type="checkbox" value={tag.id}')
    expect(app).toContain('checked={pickedTags.includes(tag.id)}')
    expect(app).toContain(
      'onChange={(e) => setPickedTags(e.target.checked ? [...pickedTags, tag.id] : pickedTags.filter((v) => v !== tag.id))}'
    )
    expect(app).toContain('{tag.name}')
  })

  test('shadcn emits dynamic SelectItem, RadioGroupItem, and Checkbox rows', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [
        { id: 's-options', name: 'options', type: 'array', defaultValue: [] },
        { id: 's-choice', name: 'choice', type: 'string', defaultValue: '' },
        { id: 's-choices', name: 'choices', type: 'array', defaultValue: [] }
      ]
    })
    const optionsSource = {
      kind: 'ref',
      stateId: 's-options',
      itemName: 'opt',
      valueExpr: 'opt.value',
      labelExpr: 'opt.label'
    }
    graph.createNode('SELECT', page.id, {
      interactiveProps: { optionsSource },
      bindings: { value: { kind: 'ref', stateId: 's-choice' } }
    })
    graph.createNode('RADIO', page.id, {
      interactiveProps: { optionsSource },
      bindings: { value: { kind: 'ref', stateId: 's-choice' } }
    })
    graph.createNode('CHECKBOX', page.id, {
      interactiveProps: { optionsSource },
      bindings: { value: { kind: 'ref', stateId: 's-choices' } }
    })

    const app = compileApp(graph, page.id, 'shadcn')

    expect(app).toContain('<Select value={choice} onValueChange={(value) => setChoice(value)}>')
    expect(app).toContain('{(options).map((opt, index) => (')
    expect(app).toContain('<SelectItem key={index} value={opt.value}>{opt.label}</SelectItem>')
    expect(app).toContain('<RadioGroupItem value={opt.value} id={"')
    expect(app).toContain('checked={choices.includes(opt.value)}')
    expect(app).toContain(
      'onCheckedChange={(checked) => setChoices(checked === true ? [...choices, opt.value] : choices.filter((v) => v !== opt.value))}'
    )
  })
})
