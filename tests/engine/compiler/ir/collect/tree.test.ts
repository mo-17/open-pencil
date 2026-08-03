import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { SceneGraph } from '@open-pencil/core'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

describe('collectTree (IR layer)', () => {
  test('empty page → empty IR children', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    const ir = collectTree(graph, pageId)
    expect(ir.pageId).toBe(pageId)
    expect(ir.pageName).toBe(page?.name ?? '')
    expect(ir.children).toEqual([])
  })

  test('unknown pageId → empty IRTree, no throw', () => {
    const graph = makeSceneGraph()
    const ir = collectTree(graph, 'does-not-exist')
    expect(ir.children).toEqual([])
    expect(ir.pageName).toBe('Page')
  })

  test('FRAME / RECTANGLE / TEXT → div / div / p with className', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, { width: 200, height: 80 })
    graph.createNode('RECTANGLE', frame.id, { width: 50, height: 50 })
    graph.createNode('TEXT', frame.id, { text: 'Hello' })

    const ir = collectTree(graph, pageId)
    expect(ir.children).toHaveLength(1)
    const root = ir.children[0] as IRElement
    expect(root.kind).toBe('element')
    expect(root.tag).toBe('div')
    expect(root.sourceId).toBe(frame.id)

    expect(root.children).toHaveLength(2)
    const [rect, text] = root.children as [IRElement, IRElement]
    expect(rect.tag).toBe('div')
    expect(text.tag).toBe('p')
    expect(text.children).toHaveLength(1)
    expect(text.children[0]).toEqual({ kind: 'text', value: 'Hello' })
  })

  test('invisible children are skipped', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, { width: 50, height: 50, visible: false })
    graph.createNode('RECTANGLE', pageId, { width: 50, height: 50 })

    const ir = collectTree(graph, pageId)
    expect(ir.children).toHaveLength(1)
  })

  test('BUTTON → <button> with text and label color from interactiveProps', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, {
      interactiveProps: { text: 'Save', textColor: '#F7F4EE' }
    })

    const ir = collectTree(graph, pageId)
    const btn = ir.children[0] as IRElement
    expect(btn.tag).toBe('button')
    expect(btn.attrs.type).toBe('button')
    expect(btn.children).toEqual([{ kind: 'text', value: 'Save' }])
    expect(btn.className).toContain('text-[#F7F4EE]')
  })

  test('INPUT → <input> with placeholder attr', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('INPUT', pageId)

    const ir = collectTree(graph, pageId)
    const input = ir.children[0] as IRElement
    expect(input.tag).toBe('input')
    expect(input.attrs.placeholder).toBe('Enter text')
    expect(input.children).toEqual([])
  })

  test('INPUT / TEXTAREA preserve text colors and typography in IR classes', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('INPUT', pageId, {
      fontFamily: 'IBM Plex Sans',
      fontSize: 17,
      fontWeight: 600,
      interactiveProps: {
        placeholder: 'Email',
        textColor: '#F7F4EE',
        placeholderColor: '#8B8B93'
      }
    })
    graph.createNode('TEXTAREA', pageId, {
      fontFamily: 'Noto Sans',
      fontSize: 15,
      fontWeight: 700,
      interactiveProps: {
        placeholder: 'Notes',
        textColor: '#112233',
        placeholderColor: '#AABBCC'
      }
    })

    const ir = collectTree(graph, pageId)
    const [input, textarea] = ir.children as [IRElement, IRElement]

    expect(input.tag).toBe('input')
    expect(input.attrs.placeholder).toBe('Email')
    expect(input.className).toContain('text-[#F7F4EE]')
    expect(input.className).toContain('placeholder:text-[#8B8B93]')
    expect(input.className).toContain('font-[IBM_Plex_Sans]')
    expect(input.className).toContain('text-[17px]')
    expect(input.className).toContain('font-semibold')

    expect(textarea.tag).toBe('textarea')
    expect(textarea.attrs.placeholder).toBe('Notes')
    expect(textarea.className).toContain('text-[#112233]')
    expect(textarea.className).toContain('placeholder:text-[#AABBCC]')
    expect(textarea.className).toContain('font-[Noto_Sans]')
    expect(textarea.className).toContain('text-[15px]')
    expect(textarea.className).toContain('font-bold')
  })

  test('CHECKBOX → <input type="checkbox">', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('CHECKBOX', pageId, { interactiveProps: { checked: true } })

    const ir = collectTree(graph, pageId)
    const cb = ir.children[0] as IRElement
    expect(cb.tag).toBe('input')
    expect(cb.attrs.type).toBe('checkbox')
    expect(cb.attrs.defaultChecked).toBe(true)
  })

  test('SELECT options → <option> children', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('SELECT', pageId, {
      interactiveProps: { options: ['One', 'Two'], value: '' }
    })

    const ir = collectTree(graph, pageId)
    const sel = ir.children[0] as IRElement
    expect(sel.tag).toBe('select')
    expect(sel.children).toHaveLength(2)
    const first = sel.children[0] as IRElement
    expect(first.tag).toBe('option')
    expect(first.attrs.value).toBe('One')
    expect(first.children[0]).toEqual({ kind: 'text', value: 'One' })
  })

  test('FORM container recurses into children', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const form = graph.createNode('FORM', pageId)
    graph.createNode('INPUT', form.id)
    graph.createNode('BUTTON', form.id)

    const ir = collectTree(graph, pageId)
    const formIR = ir.children[0] as IRElement
    expect(formIR.tag).toBe('form')
    expect(formIR.children).toHaveLength(2)
    expect((formIR.children[0] as IRElement).tag).toBe('input')
    expect((formIR.children[1] as IRElement).tag).toBe('button')
  })

  test('IR is framework-neutral — does not contain JSX tokens', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId)

    const ir = collectTree(graph, pageId)
    const serialized = JSON.stringify(ir)
    expect(serialized).not.toContain('useState')
    expect(serialized).not.toContain('className=')
    expect(serialized).not.toContain('onClick=')
  })

  test('reuses Tailwind classes from the core JSX exporter', () => {
    // Sanity check: a RECTANGLE with a width should produce a width class.
    const graph = new SceneGraph()
    graph.addPage('P')
    const pageId = graph.getPages()[0].id
    graph.createNode('RECTANGLE', pageId, { width: 100, height: 100 })

    const ir = collectTree(graph, pageId)
    const rect = ir.children[0] as IRElement
    expect(rect.className.length).toBeGreaterThan(0)
  })
})
