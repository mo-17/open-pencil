import { afterEach, describe, expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'
import { createEditor, type Editor } from '@open-pencil/core/editor'
import {
  EFFECT_PICK_CATALOG,
  createEffectPickModuleFrameOverrides,
  getEffectPickCatalogEntry,
  resolveEffectPickModule,
  type EffectPickConfigV1
} from '@open-pencil/core/plugins'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  effectPickInactiveEvents,
  planEffectPickSwitch,
  switchEffectPick
} from '@/app/effect-pick/switch'
import type { ModuleEditorCommit } from '@/app/lowcode/module-editor/owner'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
})

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('Missing EffectPick test fixture')
  return value
}

function fixture(effectId = 'diagonal-fill', name?: string) {
  const editor = createEditor()
  editors.push(editor)
  const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    name: 'Authored container',
    x: 80,
    y: 90,
    width: 700,
    height: 500
  })
  const overrides = createEffectPickModuleFrameOverrides({
    effectId,
    text: 'Author text 汉字',
    color: '#12345678',
    secondaryColor: '#abcdef',
    speed: 2.5
  })
  const owner = editor.graph.createNode('FRAME', parent.id, {
    ...overrides,
    ...(name === undefined ? {} : { name }),
    x: 37,
    y: 41,
    width: 224,
    height: 101,
    rotation: 19,
    opacity: 0.75,
    bindings: {
      opacity: { kind: 'literal', literalValue: 0.75 },
      text: { kind: 'docState', docStateName: 'effectLabel' }
    },
    events: {
      onClick: [
        { id: 'click', kind: 'setVariable', targetName: 'clicks', valueExpr: '$prev + 1' },
        { id: 'navigate-click', kind: 'navigate', to: '/checkout' }
      ],
      onFocus: [{ id: 'focus', kind: 'navigate', to: '/focus' }],
      onBlur: [{ id: 'blur', kind: 'setVariable', targetName: 'focused', valueExpr: 'false' }],
      onChange: [{ id: 'change', kind: 'setVariable', targetName: 'changes', valueExpr: '1' }],
      onSubmit: [{ id: 'submit', kind: 'navigate', to: '/submit' }]
    },
    interactiveProps: {
      ...overrides.interactiveProps,
      lang: 'zh-CN',
      authoredSettings: { enabled: true, values: [1, 2] }
    }
  })
  const child = editor.graph.createNode('RECTANGLE', owner.id, {
    name: 'Authored child',
    width: 10,
    height: 10
  })
  editor.select([owner.id])
  editor.undo.clear()
  const request = (value: string): ModuleEditorCommit<string> => ({
    owner,
    previousModule: structuredClone(owner.interactiveProps?.module),
    value
  })
  return { editor, owner, parent, child, request }
}

function config(node: SceneNode): EffectPickConfigV1 {
  const resolved = resolveEffectPickModule(node.interactiveProps?.module)
  if (!resolved?.ok) throw new Error('Expected a reviewed EffectPick module')
  return resolved.config
}

describe('switching a reviewed EffectPick instance', () => {
  test('switches from the legacy button to every added effect using target identity and only compatible edited parameters', () => {
    const added = EFFECT_PICK_CATALOG.filter((entry) => entry.collectionVersion === '0.7.0')
    expect(added).toHaveLength(20)
    for (const target of added) {
      const { editor, owner, parent, child, request } = fixture()
      const before = structuredClone(owner)
      const parentBefore = structuredClone(parent)
      const childBefore = structuredClone(child)
      const plan = required(switchEffectPick(editor, request(target.id), 'Switch collection'))
      expect(plan.instance.configVersion).toBe(1)
      expect(config(owner)).toEqual({
        ...target.defaultConfig,
        text: target.editableFields.includes('text')
          ? 'Author text 汉字'
          : target.defaultConfig.text,
        color: target.editableFields.includes('color') ? '#12345678' : target.defaultConfig.color,
        speed: target.editableFields.includes('speed') ? 2.5 : target.defaultConfig.speed
      })
      expect(plan.resetFields).toEqual(
        target.editableFields.includes('secondaryColor') ? ['secondaryColor'] : []
      )
      expect(plan.inactiveEvents).toEqual(target.events.includes('click') ? [] : ['onClick'])
      expect(editor.graph.getNode(owner.id)).toBe(owner)
      expect(owner).toEqual({
        ...before,
        name: plan.name,
        interactiveProps: { ...before.interactiveProps, module: plan.instance },
        source: { ...before.source, editedFields: ['interactiveProps', 'name'] }
      })
      expect(parent).toEqual(parentBefore)
      expect(child).toEqual(childBefore)
      const after = structuredClone(owner)
      expect(editor.undo.undo()).toBe('Switch collection')
      expect(owner).toEqual({ ...before, source: after.source })
      expect(config(owner).collectionVersion).toBe('0.6.0')
      expect(editor.undo.redo()).toBe('Switch collection')
      expect(owner).toEqual(after)
      expect(config(owner).collectionVersion).toBe('0.7.0')
    }
  })

  test('preserves shared editable parameters and takes hidden or newly exposed values from target defaults', () => {
    const { owner } = fixture()
    const before = structuredClone(owner)
    const gradient = required(planEffectPickSwitch(owner, 'animated-gradient'))
    const gradientDefaults = required(getEffectPickCatalogEntry('animated-gradient')).defaultConfig
    expect(gradient.instance.config).toEqual({
      ...gradientDefaults,
      text: 'Author text 汉字',
      color: '#12345678',
      speed: 2.5
    })
    expect(gradient.resetFields).toEqual(['secondaryColor'])
    expect(gradient.inactiveEvents).toEqual(['onClick'])
    expect(owner).toEqual(before)

    const { owner: gradientOwner } = fixture('animated-gradient')
    const loader = required(planEffectPickSwitch(gradientOwner, 'orbit-eclipse'))
    expect(loader.instance.config).toEqual({
      ...required(getEffectPickCatalogEntry('orbit-eclipse')).defaultConfig,
      color: '#12345678',
      secondaryColor: '#abcdef',
      speed: 2.5
    })
    expect(loader.resetFields).toEqual([])

    const { owner: loaderOwner } = fixture('gooey-dots')
    const text = required(planEffectPickSwitch(loaderOwner, 'water-text'))
    expect(text.instance.config).toEqual({
      ...required(getEffectPickCatalogEntry('water-text')).defaultConfig,
      color: '#12345678',
      speed: 2.5
    })
    expect(text.resetFields).toEqual(['text'])
  })

  test('one undo transaction changes only the module and automatic name, preserving identity and all authored node data', () => {
    const { editor, owner, parent, child, request } = fixture()
    const before = structuredClone(owner)
    const parentBefore = structuredClone(parent)
    const childBefore = structuredClone(child)
    const events = owner.events
    const nodeCount = [...editor.graph.getAllNodes()].length
    const plan = required(switchEffectPick(editor, request('gradient-button'), 'Switch effect'))
    expect(editor.graph.getNode(owner.id)).toBe(owner)
    expect(owner).toEqual({
      ...before,
      name: plan.name,
      interactiveProps: { ...before.interactiveProps, module: plan.instance },
      source: { ...before.source, editedFields: ['interactiveProps', 'name'] }
    })
    expect(owner.events).toBe(events)
    expect(parent).toEqual(parentBefore)
    expect(child).toEqual(childBefore)
    expect([...editor.graph.getAllNodes()]).toHaveLength(nodeCount)
    const after = structuredClone(owner)
    expect(editor.undo.undo()).toBe('Switch effect')
    expect(owner).toEqual({ ...before, source: after.source })
    expect(editor.undo.canUndo).toBe(false)
    expect(editor.undo.redo()).toBe('Switch effect')
    expect(owner).toEqual(after)
    expect(editor.undo.canRedo).toBe(false)
  })

  test('retains click actions while inactive and restores their eligibility when switching back', () => {
    const { editor, owner, request } = fixture('arrow-expand')
    const events = structuredClone(owner.events)
    const first = required(switchEffectPick(editor, request('aurora-curtains'), 'Switch out'))
    expect(first.inactiveEvents).toEqual(['onClick'])
    expect(effectPickInactiveEvents(owner)).toEqual(['onClick'])
    expect(owner.events).toEqual(events)
    const second = required(switchEffectPick(editor, request('arrow-expand'), 'Switch back'))
    expect(second.inactiveEvents).toEqual([])
    expect(effectPickInactiveEvents(owner)).toEqual([])
    expect(owner.events).toEqual(events)
    editor.undo.undo()
    expect(config(owner).effectId).toBe('aurora-curtains')
    expect(owner.events).toEqual(events)
    editor.undo.undo()
    expect(config(owner).effectId).toBe('arrow-expand')
    expect(owner.events).toEqual(events)
    editor.undo.redo()
    editor.undo.redo()
    expect(config(owner).effectId).toBe('arrow-expand')
    expect(owner.events).toEqual(events)
  })

  test('does not report inactive events without authored click actions and never changes other events', () => {
    const { owner } = fixture()
    for (const events of [undefined, {}, { onClick: [] }, { onFocus: owner.events?.onFocus }]) {
      const current = { ...owner, events }
      const before = structuredClone(current)
      expect(required(planEffectPickSwitch(current, 'animated-gradient')).inactiveEvents).toEqual(
        []
      )
      expect(current).toEqual(before)
    }
  })

  test('updates both automatic name forms and retains custom names', () => {
    const { owner } = fixture()
    const source = required(getEffectPickCatalogEntry('diagonal-fill'))
    const target = required(getEffectPickCatalogEntry('animated-gradient'))
    for (const [name, expected] of [
      [source.title, target.title],
      [`EffectPick · ${source.title} · Static`, `EffectPick · ${target.title} · Static`],
      ['My checkout CTA', 'My checkout CTA']
    ]) {
      expect(required(planEffectPickSwitch({ ...owner, name }, target.id)).name).toBe(expected)
    }
  })

  test('switching a custom-named instance preserves its name without marking it edited', () => {
    const { editor, owner, request } = fixture('diagonal-fill', 'Checkout CTA')
    const before = structuredClone(owner)
    switchEffectPick(editor, request('animated-gradient'), 'Keep custom name')
    expect(owner.name).toBe(before.name)
    expect(owner.source.editedFields).toEqual(['interactiveProps'])
    expect(editor.undo.undo()).toBe('Keep custom name')
    expect(owner.name).toBe(before.name)
    expect(editor.undo.redo()).toBe('Keep custom name')
    expect(owner.name).toBe(before.name)
  })

  test('same-effect requests make no graph mutation or undo entry', () => {
    for (const effectId of ['diagonal-fill', 'arrow-expand']) {
      const { editor, owner, request } = fixture(effectId)
      const before = structuredClone([...editor.graph.getAllNodes()])
      expect(planEffectPickSwitch(owner, effectId)).toBeUndefined()
      expect(switchEffectPick(editor, request(effectId), 'Same effect')).toBeUndefined()
      expect([...editor.graph.getAllNodes()]).toEqual(before)
      expect(editor.undo.canUndo).toBe(false)
    }
  })

  test.each(['diagonal-fill', 'arrow-expand'])(
    'rejects unreviewed targets and altered %s identities without partial mutation',
    (effectId) => {
      const { editor, owner, request } = fixture(effectId)
      const before = structuredClone(owner)
      expect(() =>
        switchEffectPick(editor, request('unreviewed-script'), 'Invalid target')
      ).toThrow()
      expect(owner).toEqual(before)
      const module = resolveEffectPickModule(owner.interactiveProps?.module)
      if (!module?.ok) throw new Error('Expected a reviewed EffectPick module')
      for (const config of [
        { ...module.config, artifactDigest: '0'.repeat(64) },
        { ...module.config, collectionVersion: effectId === 'diagonal-fill' ? '0.7.0' : '0.6.0' }
      ]) {
        editor.graph.updateNode(owner.id, {
          interactiveProps: {
            ...owner.interactiveProps,
            module: { ...module.instance, config }
          }
        })
        const invalid = structuredClone(owner)
        expect(() =>
          switchEffectPick(editor, request('animated-gradient'), 'Invalid source')
        ).toThrow()
        expect(owner).toEqual(invalid)
        expect(editor.undo.canUndo).toBe(false)
      }
    }
  )

  test('rapid requests reject a stale module snapshot and accept the next request from the latest instance', () => {
    const { editor, owner, request } = fixture()
    const initial = structuredClone(owner)
    const first = request('gradient-button')
    const stale = request('water-text')
    expect(switchEffectPick(editor, first, 'Gradient')).toBeDefined()
    const gradient = structuredClone(owner)
    expect(switchEffectPick(editor, stale, 'Stale water')).toBeUndefined()
    expect(owner).toEqual(gradient)
    expect(switchEffectPick(editor, request('water-text'), 'Water')).toBeDefined()
    expect(config(owner).effectId).toBe('water-text')
    expect(editor.undo.undo()).toBe('Water')
    expect(owner).toEqual(gradient)
    expect(editor.undo.undo()).toBe('Gradient')
    expect(owner).toEqual({ ...initial, source: gradient.source })
    expect(editor.undo.canUndo).toBe(false)
  })

  test('selection ownership prevents one instance request from changing another instance', () => {
    const { editor, owner, parent, request } = fixture()
    const sibling = editor.graph.createNode(
      'FRAME',
      parent.id,
      createEffectPickModuleFrameOverrides()
    )
    const firstBefore = structuredClone(owner)
    const pending = request('animated-gradient')
    editor.select([sibling.id])
    expect(switchEffectPick(editor, pending, 'Wrong owner')).toBeUndefined()
    const next = {
      owner: sibling,
      previousModule: structuredClone(sibling.interactiveProps?.module),
      value: 'text-mask-reveal'
    }
    expect(switchEffectPick(editor, next, 'Second owner')).toBeDefined()
    expect(owner).toEqual(firstBefore)
    expect(config(sibling).effectId).toBe('text-mask-reveal')
    expect(config(owner).effectId).toBe('diagonal-fill')
  })

  test('requests use the latest event edits while preserving every event', () => {
    const { editor, owner, request } = fixture()
    const pending = request('animated-gradient')
    const events: SceneNode['events'] = {
      onClick: [{ id: 'new-click', kind: 'navigate', to: '/new' }]
    }
    editor.graph.updateNode(owner.id, { events })
    expect(required(switchEffectPick(editor, pending, 'Latest events')).inactiveEvents).toEqual([
      'onClick'
    ])
    expect(owner.events).toEqual(events)
  })

  test('rejects a pending switch after moving to another page', async () => {
    const { editor, owner, request } = fixture()
    const pending = request('animated-gradient')
    const otherPage = editor.graph.addPage('Other page')
    await editor.switchPage(otherPage.id)
    editor.select([owner.id])
    const before = structuredClone([...editor.graph.getAllNodes()])
    expect(switchEffectPick(editor, pending, 'Previous page')).toBeUndefined()
    expect([...editor.graph.getAllNodes()]).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
  })

  for (const boundary of [
    'selection',
    'multiple',
    'locked',
    'hidden',
    'internal',
    'parent-locked',
    'parent-hidden',
    'parent-internal',
    'deleted',
    'replacement',
    'changed-module',
    'copied-owner'
  ] as const) {
    test(`rejects late effect changes after ${boundary}`, () => {
      const { editor, owner, parent, request } = fixture()
      let pending = request('animated-gradient')
      if (boundary === 'selection') editor.clearSelection()
      if (boundary === 'multiple') editor.select([owner.id, parent.id])
      if (boundary === 'locked') editor.graph.updateNode(owner.id, { locked: true })
      if (boundary === 'hidden') editor.graph.updateNode(owner.id, { visible: false })
      if (boundary === 'internal') editor.graph.updateNode(owner.id, { internalOnly: true })
      if (boundary === 'parent-locked') editor.graph.updateNode(parent.id, { locked: true })
      if (boundary === 'parent-hidden') editor.graph.updateNode(parent.id, { visible: false })
      if (boundary === 'parent-internal') editor.graph.updateNode(parent.id, { internalOnly: true })
      if (boundary === 'deleted') editor.graph.deleteNode(owner.id)
      if (boundary === 'replacement') {
        const replacement = new SceneGraph()
        const nextOwner = replacement.createNode('FRAME', replacement.getPages()[0].id, {
          ...structuredClone(owner),
          parentId: replacement.getPages()[0].id,
          childIds: []
        })
        editor.replaceGraph(replacement)
        editor.select([nextOwner.id])
      }
      if (boundary === 'changed-module') {
        editor.graph.updateNode(
          owner.id,
          createEffectPickModuleFrameOverrides({ text: 'New saved text' })
        )
      }
      if (boundary === 'copied-owner') pending = { ...pending, owner: structuredClone(owner) }
      const before = structuredClone([...editor.graph.getAllNodes()])
      expect(switchEffectPick(editor, pending, 'Late effect')).toBeUndefined()
      expect([...editor.graph.getAllNodes()]).toEqual(before)
      expect(editor.undo.canUndo).toBe(false)
    })
  }

  test.each(['animated-gradient', 'gradient-button'])(
    'switched %s identity, outer paints, authored events and bindings survive a FIG save and reopen',
    async (effectId) => {
      await initCodec()
      for (const outerPaint of ['default', 'authored'] as const) {
        const { editor, owner, request } = fixture()
        expect(owner.fills).toEqual([])
        expect(owner.strokes).toEqual([])
        if (outerPaint === 'authored') {
          editor.graph.updateNode(owner.id, {
            fills: [
              {
                type: 'SOLID',
                color: { r: 1, g: 0, b: 0, a: 1 },
                opacity: 0.5,
                visible: true,
                blendMode: 'NORMAL'
              }
            ],
            strokes: [
              {
                type: 'SOLID',
                color: { r: 0, g: 1, b: 0, a: 1 },
                opacity: 1,
                visible: true,
                blendMode: 'NORMAL',
                weight: 3,
                align: 'INSIDE',
                cap: 'NONE',
                join: 'MITER',
                dashPattern: []
              }
            ]
          })
        }
        const oldNode = structuredClone(owner)
        switchEffectPick(editor, request(effectId), 'Switch before save')
        expect(owner.fills).toEqual(oldNode.fills)
        expect(owner.strokes).toEqual(oldNode.strokes)
        const before = structuredClone(owner)
        const bytes = await exportFigFile(editor.graph)
        const restored = await parseFigFile(new Uint8Array(bytes).buffer)
        const reopened = required(
          [...restored.getAllNodes()].find((node) => node.name === owner.name)
        )
        expect(reopened.type).toBe('FRAME')
        expect(reopened.fills).toEqual(before.fills)
        expect(reopened.strokes).toEqual(before.strokes)
        expect(reopened.interactiveProps).toEqual(before.interactiveProps)
        expect(reopened.events).toEqual(before.events)
        expect(reopened.bindings).toEqual(before.bindings)
        expect(config(reopened)).toEqual(config(owner))
        expect(reopened.childIds).toHaveLength(before.childIds.length)
        for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const)
          expect(reopened[key]).toBeCloseTo(before[key], 4)
      }
    }
  )
})
