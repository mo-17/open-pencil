import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SceneGraph, renderJSX, sceneNodeToJSX, selectionToJSX } from '@open-pencil/core'
import { buildComponent, createElement, resolveToTree } from '@open-pencil/design-jsx'
function makeGraph() {
  const graph = new SceneGraph()
  graph.createNode('CANVAS', graph.rootId, { name: 'Page 1' })
  return graph
}
function pageId(graph: SceneGraph) {
  return graph.getPages()[0].id
}
describe('Lowcode export compatibility and bound renderer', () => {
  test('button node emits html button in tailwind format', () => {
    const graph = makeGraph()
    const node = graph.createNode('BUTTON', pageId(graph), {
      width: 120,
      height: 40,
      interactiveProps: { text: 'Save' }
    })

    const jsx = sceneNodeToJSX(node.id, graph, 'tailwind')
    expect(jsx).toContain('<button')
    expect(jsx).toContain('>Save</button>')
  })
  test('input node exposes placeholder in OpenPencil and tailwind formats', () => {
    const graph = makeGraph()
    const node = graph.createNode('INPUT', pageId(graph), {
      name: 'Email Field',
      width: 240,
      height: 36,
      interactiveProps: { placeholder: 'Email address', value: 'hello@example.com' }
    })

    const openpencil = sceneNodeToJSX(node.id, graph)
    expect(openpencil).toContain('<Input')
    expect(openpencil).toContain('name="Email Field"')
    expect(openpencil).toContain('placeholder="Email address"')
    expect(openpencil).toContain('value="hello@example.com"')
    expect(selectionToJSX([node.id], graph)).toContain('<Input')

    const tailwind = sceneNodeToJSX(node.id, graph, 'tailwind')
    expect(tailwind).toContain('<input')
    expect(tailwind).toContain('placeholder="Email address"')
    expect(tailwind).toContain('defaultValue="hello@example.com"')
  })
  test('select node exposes options in OpenPencil and tailwind formats', () => {
    const graph = makeGraph()
    const node = graph.createNode('SELECT', pageId(graph), {
      name: 'Country Select',
      width: 220,
      height: 36,
      interactiveProps: { options: ['US', 'JP'], value: 'JP' }
    })

    const openpencil = sceneNodeToJSX(node.id, graph)
    expect(openpencil).toContain('<Select')
    expect(openpencil).toContain('name="Country Select"')
    expect(
      expectDefined(resolveToTree(createElement(buildComponent(openpencil), null))).props.options
    ).toEqual(['US', 'JP'])
    expect(openpencil).toContain('value="JP"')
    expect(selectionToJSX([node.id], graph)).toContain('<Select')

    const tailwind = sceneNodeToJSX(node.id, graph, 'tailwind')
    expect(tailwind).toContain('<select')
    expect(tailwind).toContain('defaultValue="JP"')
    expect(tailwind).toContain('<option value="US">US</option>')
    expect(tailwind).toContain('<option value="JP">JP</option>')
  })
  test('all lowcode node types survive an OpenPencil JSX round trip', async () => {
    const source = makeGraph()
    const root = source.createNode('FRAME', pageId(source), { name: 'Round-trip controls' })
    source.createNode('BUTTON', root.id, {
      name: 'Submit',
      interactiveProps: { text: 'Save', textColor: '#F9FAFB' }
    })
    source.createNode('INPUT', root.id, {
      name: 'Email',
      interactiveProps: {
        placeholder: 'Email address',
        value: 'ada@example.com',
        textColor: '#F7F4EE',
        placeholderColor: '#8B8B93',
        validation: { required: true }
      }
    })
    source.createNode('SELECT', root.id, {
      name: 'Role',
      interactiveProps: { options: ['Admin', 'Editor'], value: 'Editor' }
    })
    source.createNode('CHECKBOX', root.id, {
      name: 'Topics',
      interactiveProps: { options: ['News', 'Events'], checked: true }
    })
    source.createNode('FORM', root.id, {
      name: 'Profile form',
      interactiveProps: { validationSummary: { enabled: true, title: 'Fix fields' } }
    })
    source.createNode('LIST', root.id, {
      name: 'Results',
      interactiveProps: {
        dataSourceRef: { kind: 'stateRef', stateId: 'items' },
        itemName: 'entry',
        indexName: 'entryIndex'
      }
    })
    source.createNode('RADIO', root.id, {
      name: 'Plan',
      interactiveProps: { options: ['Free', 'Pro'], value: 'Pro', groupName: 'plans' }
    })
    source.createNode('TEXTAREA', root.id, {
      name: 'Bio',
      interactiveProps: {
        placeholder: 'About you',
        value: 'Hello',
        textColor: '#111827',
        placeholderColor: '#6B7280'
      }
    })
    source.createNode('DATEPICKER', root.id, {
      name: 'Birthday',
      interactiveProps: { value: '2026-07-27', min: '2020-01-01', max: '2030-01-01' }
    })
    source.createNode('SWITCH', root.id, {
      name: 'Alerts',
      interactiveProps: { checked: true }
    })

    const jsx = sceneNodeToJSX(root.id, source)
    expect(jsx).toContain('textColor="#F9FAFB"')
    expect(jsx).toContain('textColor="#F7F4EE"')
    expect(jsx).toContain('placeholderColor="#8B8B93"')
    expect(jsx).toContain('textColor="#111827"')
    expect(jsx).toContain('placeholderColor="#6B7280"')

    const target = makeGraph()
    const [rendered] = await renderJSX(target, jsx)
    const renderedRoot = target.getNode(rendered.id)
    expect(renderedRoot).toBeDefined()

    const children = (renderedRoot?.childIds ?? []).map((id) => target.getNode(id))
    expect(children.map((node) => node?.type)).toEqual([
      'BUTTON',
      'INPUT',
      'SELECT',
      'CHECKBOX',
      'FORM',
      'LIST',
      'RADIO',
      'TEXTAREA',
      'DATEPICKER',
      'SWITCH'
    ])

    expect(children[0]?.interactiveProps).toMatchObject({ text: 'Save', textColor: '#F9FAFB' })
    expect(children[1]?.interactiveProps).toMatchObject({
      placeholder: 'Email address',
      value: 'ada@example.com',
      textColor: '#F7F4EE',
      placeholderColor: '#8B8B93',
      validation: { required: true }
    })
    expect(children[2]?.interactiveProps).toMatchObject({
      options: ['Admin', 'Editor'],
      value: 'Editor'
    })
    expect(children[3]?.interactiveProps).toMatchObject({
      options: ['News', 'Events'],
      checked: true
    })
    expect(children[4]?.interactiveProps).toMatchObject({
      validationSummary: { enabled: true, title: 'Fix fields' }
    })
    expect(children[5]?.interactiveProps).toMatchObject({
      dataSourceRef: { kind: 'stateRef', stateId: 'items' },
      itemName: 'entry',
      indexName: 'entryIndex'
    })
    expect(children[6]?.interactiveProps).toMatchObject({
      options: ['Free', 'Pro'],
      value: 'Pro',
      groupName: 'plans'
    })
    expect(children[7]?.interactiveProps).toMatchObject({
      placeholder: 'About you',
      value: 'Hello',
      textColor: '#111827',
      placeholderColor: '#6B7280'
    })
    expect(children[8]?.interactiveProps).toMatchObject({
      value: '2026-07-27',
      min: '2020-01-01',
      max: '2030-01-01'
    })
    expect(children[9]?.interactiveProps).toMatchObject({ checked: true })
  })
  test('escaped string props and select options survive export and render', async () => {
    const source = makeGraph()
    const root = source.createNode('FRAME', pageId(source), { name: 'Escaped values' })
    const fieldValue = 'Say "hello" from C:\\temp\nnext line'
    const optionValue = 'Choice "A" at C:\\tmp\nsecond line'
    source.createNode('INPUT', root.id, {
      name: 'Escaped input',
      interactiveProps: { placeholder: fieldValue, value: fieldValue }
    })
    const select = source.createNode('SELECT', root.id, {
      name: 'Escaped select',
      interactiveProps: { options: [optionValue, 'Plain'], value: optionValue }
    })

    const jsx = sceneNodeToJSX(root.id, source)
    expect(jsx).toContain(`placeholder={${JSON.stringify(fieldValue)}}`)
    expect(jsx).toContain(`value={${JSON.stringify(optionValue)}}`)

    const target = makeGraph()
    const [rendered] = await renderJSX(target, jsx)
    const children = target.getChildren(rendered.id)
    expect(children[0]?.interactiveProps).toMatchObject({
      placeholder: fieldValue,
      value: fieldValue
    })
    expect(children[1]?.interactiveProps).toMatchObject({
      options: [optionValue, 'Plain'],
      value: optionValue
    })

    const tailwind = sceneNodeToJSX(select.id, source, 'tailwind')
    expect(tailwind).toContain(`<option value={${JSON.stringify(optionValue)}}>`)
  })
  test('all lowcode node types use semantic HTML tags in tailwind format', () => {
    const graph = makeGraph()
    const parent = pageId(graph)
    const button = graph.createNode('BUTTON', parent, { interactiveProps: { text: 'Save' } })
    const input = graph.createNode('INPUT', parent, {
      interactiveProps: { placeholder: 'Email', value: 'ada@example.com' }
    })
    const select = graph.createNode('SELECT', parent, {
      interactiveProps: { options: ['A', 'B'], value: 'B' }
    })
    const checkbox = graph.createNode('CHECKBOX', parent, {
      interactiveProps: { checked: true }
    })
    const form = graph.createNode('FORM', parent)
    const list = graph.createNode('LIST', parent)
    const radio = graph.createNode('RADIO', parent, {
      interactiveProps: { options: ['Yes', 'No'], value: 'Yes', groupName: 'answer' }
    })
    const textarea = graph.createNode('TEXTAREA', parent, {
      interactiveProps: { placeholder: 'Notes', value: 'Draft' }
    })
    const datepicker = graph.createNode('DATEPICKER', parent, {
      interactiveProps: { value: '2026-07-27', min: '2026-01-01', max: '2026-12-31' }
    })
    const switchNode = graph.createNode('SWITCH', parent, {
      interactiveProps: { checked: true }
    })

    expect(sceneNodeToJSX(button.id, graph, 'tailwind')).toContain('type="button"')
    expect(sceneNodeToJSX(input.id, graph, 'tailwind')).toContain('type="text"')
    expect(sceneNodeToJSX(select.id, graph, 'tailwind')).toContain('<select')
    expect(sceneNodeToJSX(checkbox.id, graph, 'tailwind')).toContain('type="checkbox"')
    expect(sceneNodeToJSX(form.id, graph, 'tailwind')).toContain('<form')
    expect(sceneNodeToJSX(list.id, graph, 'tailwind')).toContain('<div')

    const radioJSX = sceneNodeToJSX(radio.id, graph, 'tailwind')
    expect(radioJSX).toContain('<div')
    expect(radioJSX).toContain('role="radiogroup"')
    expect(radioJSX).toContain('type="radio"')
    expect(radioJSX).toContain('name="answer"')
    expect(radioJSX).toContain('defaultChecked')

    const textareaJSX = sceneNodeToJSX(textarea.id, graph, 'tailwind')
    expect(textareaJSX).toContain('<textarea')
    expect(textareaJSX).toContain('placeholder="Notes"')
    expect(textareaJSX).toContain('defaultValue="Draft"')

    const datepickerJSX = sceneNodeToJSX(datepicker.id, graph, 'tailwind')
    expect(datepickerJSX).toContain('type="date"')
    expect(datepickerJSX).toContain('defaultValue="2026-07-27"')
    expect(datepickerJSX).toContain('min="2026-01-01"')
    expect(datepickerJSX).toContain('max="2026-12-31"')

    const switchJSX = sceneNodeToJSX(switchNode.id, graph, 'tailwind')
    expect(switchJSX).toContain('type="checkbox"')
    expect(switchJSX).toContain('role="switch"')
    expect(switchJSX).toContain('defaultChecked')
  })
})
