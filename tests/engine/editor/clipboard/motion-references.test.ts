import { describe, expect, test } from 'bun:test'

import {
  buildFigmaClipboardHTML,
  buildOpenPencilClipboardHTML,
  importClipboardNodes,
  parseFigmaClipboard,
  parseOpenPencilClipboard
} from '@open-pencil/core/clipboard'
import { createEditor } from '@open-pencil/core/editor'
import {
  createMotionPreset,
  upgradeMotionSpecV2,
  type ActionDef,
  type SceneNode
} from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'
import { advancedMotionSpec } from '#tests/helpers/motion-v3-advanced'

function createMotionRoots(editor: ReturnType<typeof createEditor>) {
  const pageId = editor.state.currentPageId
  const motion = upgradeMotionSpecV2(createMotionPreset('fade-in'))
  motion.version = 3
  motion.preset = { id: 'user-card-enter', version: 2, parameters: {} }
  const structuredFrames = advancedMotionSpec().tracks[0].keyframes
  for (const [index, frame] of motion.tracks[0].keyframes.entries()) {
    frame.cornerRadius = 4 + frame.offset * 12
    frame.fillColor = { r: 1 - frame.offset, g: 0.2, b: frame.offset, a: 1 }
    const structured = structuredFrames[index]
    if (!structured) throw new Error(`Expected structured keyframe ${index}`)
    frame.paints = structured.paints
    frame.gradientStops = structured.gradientStops
    frame.effects = structured.effects
    frame.cornerRadii = structured.cornerRadii
    frame.textReveal = structured.textReveal
    frame.fontAxes = structured.fontAxes
    frame.vectorMorph = structured.vectorMorph
  }
  const target = editor.graph.createNode('RECTANGLE', pageId, {
    name: 'Motion target',
    motion
  })
  const actions: ActionDef[] = [
    {
      id: 'condition',
      kind: 'condition',
      condExpr: 'true',
      consequent: [{ id: 'play', kind: 'playMotion', targetNodeId: target.id, trackId: 'fade-in' }]
    }
  ]
  const trigger = editor.graph.createNode('BUTTON', pageId, {
    name: 'Motion trigger',
    events: { onClick: actions },
    lowcodeWorkflows: [
      {
        id: 'stop-workflow',
        name: 'Stop motion',
        actions: [{ id: 'stop', kind: 'stopMotion', targetNodeId: target.id }]
      }
    ]
  })
  return { target, trigger }
}

function nestedEventTarget(node: SceneNode): string | undefined {
  const action = node.events?.onClick?.[0]
  if (action?.kind !== 'condition') return undefined
  const nested = action.consequent[0]
  return nested?.kind === 'playMotion' ? nested.targetNodeId : undefined
}

function workflowTarget(node: SceneNode): string | undefined {
  const action = node.lowcodeWorkflows?.[0]?.actions[0]
  return action?.kind === 'stopMotion' ? action.targetNodeId : undefined
}

function fakeClipboardData(values: Map<string, string>): DataTransfer {
  return {
    setData(type: string, value: string) {
      values.set(type, value)
    }
  } as DataTransfer
}

describe('clipboard motion references', () => {
  test('duplicate remaps nested events and workflows across selected roots', () => {
    const editor = createEditor()
    const { target, trigger } = createMotionRoots(editor)

    editor.select([trigger.id, target.id])
    editor.duplicateSelected()

    const duplicateRoots = [...editor.state.selectedIds].map((id) => editor.graph.getNode(id))
    const copiedTarget = expectDefined(
      duplicateRoots.find((node) => node?.name === 'Motion target copy'),
      'copied target'
    )
    const copiedTrigger = expectDefined(
      duplicateRoots.find((node) => node?.name === 'Motion trigger copy'),
      'copied trigger'
    )
    expect(nestedEventTarget(copiedTrigger)).toBe(copiedTarget.id)
    expect(workflowTarget(copiedTrigger)).toBe(copiedTarget.id)
    expect(copiedTrigger.events).not.toBe(trigger.events)
    expect(copiedTrigger.lowcodeWorkflows).not.toBe(trigger.lowcodeWorkflows)

    editor.undo.undo()
    editor.undo.redo()
    const restoredTrigger = expectDefined(
      editor.graph.getNode(copiedTrigger.id),
      'restored trigger'
    )
    expect(nestedEventTarget(restoredTrigger)).toBe(copiedTarget.id)
    expect(workflowTarget(restoredTrigger)).toBe(copiedTarget.id)
  })

  test('actual copy keeps both payloads and OpenPencil paste remaps cross-root targets', async () => {
    const source = createEditor()
    const { target, trigger } = createMotionRoots(source)
    source.select([trigger.id, target.id])

    const values = new Map<string, string>()
    await source.writeCopyData(fakeClipboardData(values))
    const html = values.get('text/html') ?? ''
    expect(parseOpenPencilClipboard(html)).not.toBeNull()
    expect(await parseFigmaClipboard(html)).not.toBeNull()

    const destination = createEditor()
    await destination.pasteFromHTML(html)
    const pastedRoots = [...destination.state.selectedIds].map((id) =>
      destination.graph.getNode(id)
    )
    const pastedTarget = expectDefined(
      pastedRoots.find((node) => node?.name === target.name),
      'pasted target'
    )
    const pastedTrigger = expectDefined(
      pastedRoots.find((node) => node?.name === trigger.name),
      'pasted trigger'
    )
    expect(pastedTarget.id).not.toBe(target.id)
    expect(pastedTarget.motion).toEqual(target.motion)
    expect(pastedTarget.motion).not.toBe(target.motion)
    expect(pastedTarget.motion?.preset).toEqual({
      id: 'user-card-enter',
      version: 2,
      parameters: {}
    })
    expect(nestedEventTarget(pastedTrigger)).toBe(pastedTarget.id)
    expect(workflowTarget(pastedTrigger)).toBe(pastedTarget.id)
  })

  test('Figma clipboard restores Motion and lowcode actions before remapping targets', async () => {
    const source = createEditor()
    const { target, trigger } = createMotionRoots(source)
    const html = expectDefined(
      await buildFigmaClipboardHTML([trigger, target], source.graph),
      'Figma clipboard HTML'
    )
    const parsed = expectDefined(await parseFigmaClipboard(html), 'parsed Figma clipboard')

    const destination = createEditor()
    const created = importClipboardNodes(
      parsed.nodes,
      destination.graph,
      destination.state.currentPageId,
      0,
      0,
      parsed.blobs
    )
    const pastedRoots = created.map((id) => destination.graph.getNode(id))
    const pastedTarget = expectDefined(
      pastedRoots.find((node) => node?.name === target.name),
      'Figma pasted target'
    )
    const pastedTrigger = expectDefined(
      pastedRoots.find((node) => node?.name === trigger.name),
      'Figma pasted trigger'
    )

    expect(pastedTarget.motion).toEqual(target.motion)
    expect(pastedTarget.motion?.preset).toEqual({
      id: 'user-card-enter',
      version: 2,
      parameters: {}
    })
    expect(pastedTrigger.type).toBe('BUTTON')
    expect(nestedEventTarget(pastedTrigger)).toBe(pastedTarget.id)
    expect(workflowTarget(pastedTrigger)).toBe(pastedTarget.id)
  })

  test('Figma clipboard reapplies a root instance Motion override after population', async () => {
    const source = createEditor()
    const pageId = source.state.currentPageId
    const component = source.graph.createNode('COMPONENT', pageId, {
      name: 'Clipboard Motion Master',
      motion: createMotionPreset('fade-in')
    })
    const instance = expectDefined(
      source.graph.createInstance(component.id, pageId),
      'source instance'
    )
    const customMotion = advancedMotionSpec()
    source.graph.updateNode(instance.id, {
      name: 'Clipboard Motion Instance',
      motion: customMotion,
      overrides: { ...instance.overrides, motion: structuredClone(customMotion) }
    })

    const html = expectDefined(
      await buildFigmaClipboardHTML([component, instance], source.graph),
      'Figma clipboard HTML'
    )
    const parsed = expectDefined(await parseFigmaClipboard(html), 'parsed Figma clipboard')
    const destination = createEditor()
    importClipboardNodes(
      parsed.nodes,
      destination.graph,
      destination.state.currentPageId,
      0,
      0,
      parsed.blobs
    )

    const pastedComponent = expectDefined(
      [...destination.graph.getAllNodes()].find(
        (node) => node.type === 'COMPONENT' && node.name === component.name
      ),
      'pasted component'
    )
    const pastedInstance = expectDefined(
      [...destination.graph.getAllNodes()].find(
        (node) => node.type === 'INSTANCE' && node.name === 'Clipboard Motion Instance'
      ),
      'pasted instance'
    )
    expect(pastedInstance.motion).toEqual(customMotion)
    expect(pastedInstance.overrides.motion).toEqual(customMotion)
    expect(pastedInstance.pendingInstanceOverrides).toBeUndefined()

    destination.graph.updateNode(pastedComponent.id, {
      motion: createMotionPreset('bounce-in')
    })
    destination.graph.syncInstances(pastedComponent.id)
    expect(pastedInstance.motion).toEqual(customMotion)
    expect(pastedInstance.overrides.motion).toEqual(customMotion)
  })

  test('OpenPencil helper paste remaps targets even without the combined UI payload', async () => {
    const source = createEditor()
    const { target, trigger } = createMotionRoots(source)
    const html = buildOpenPencilClipboardHTML([trigger, target], source.graph)
    const destination = createEditor()

    await destination.pasteFromHTML(html)

    const pastedRoots = [...destination.state.selectedIds].map((id) =>
      destination.graph.getNode(id)
    )
    const pastedTarget = expectDefined(
      pastedRoots.find((node) => node?.name === target.name),
      'helper pasted target'
    )
    const pastedTrigger = expectDefined(
      pastedRoots.find((node) => node?.name === trigger.name),
      'helper pasted trigger'
    )
    expect(pastedTarget.motion).toEqual(target.motion)
    expect(pastedTarget.motion).not.toBe(target.motion)
    expect(nestedEventTarget(pastedTrigger)).toBe(pastedTarget.id)
    expect(workflowTarget(pastedTrigger)).toBe(pastedTarget.id)
  })
})
