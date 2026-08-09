import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import {
  DESIGN_SYSTEM_AUDIT_COMMAND_ID,
  DESIGN_SYSTEM_AUDIT_LIMITS,
  DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
  runStaticDesignSystemAudit
} from '@/app/plugins/host/design-system-audit'

function editorFor(graph: SceneGraph): EditorStore {
  return { graph } as EditorStore
}

describe('static design system audit plugin', () => {
  test('reports bounded token, component, spacing, and typography consistency findings', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const collection = graph.createCollection('Theme')
    const spacing = graph.createVariable('spacing/base', 'FLOAT', collection.id, 8)
    spacing.valuesByMode = {}
    graph.createVariable('spacing/alias', 'FLOAT', collection.id, { aliasId: 'missing-token' })
    collection.variableIds = []

    graph.createNode('FRAME', page.id, {
      name: 'Off-grid card',
      itemSpacing: 10,
      paddingLeft: 7,
      boundVariables: { itemSpacing: 'missing-bound-token' }
    })
    const componentSet = graph.createNode('COMPONENT_SET', page.id, {
      name: 'Button variants',
      componentPropertyDefinitions: [
        {
          id: 'state',
          name: 'State',
          type: 'VARIANT',
          defaultValue: 'Default',
          variantOptions: ['Default', 'Hover']
        }
      ]
    })
    graph.createNode('COMPONENT', componentSet.id, {
      name: 'Default A',
      componentPropertyValues: { State: 'Default' }
    })
    graph.createNode('COMPONENT', componentSet.id, {
      name: 'Default B',
      componentPropertyValues: { State: 'Default' }
    })
    graph.createNode('COMPONENT', componentSet.id, {
      name: 'Missing state',
      componentPropertyValues: {}
    })
    graph.createNode('TEXT', page.id, {
      name: 'Heading A',
      text: 'First',
      fontFamily: 'Inter',
      fontSize: 24,
      fontWeight: 700,
      textStyleId: 'heading-style'
    })
    graph.createNode('TEXT', page.id, {
      name: 'Heading B',
      text: 'Second',
      fontFamily: 'Roboto',
      fontSize: 18,
      fontWeight: 400,
      textStyleId: 'heading-style'
    })

    const result = await runStaticDesignSystemAudit(editorFor(graph))
    const categoryCodes = new Set(result.issues.map((issue) => `${issue.category}:${issue.code}`))

    expect(result).toMatchObject({
      kind: 'static-design-system-audit',
      scope: 'document',
      pluginId: DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
      commandId: DESIGN_SYSTEM_AUDIT_COMMAND_ID,
      truncated: false
    })
    expect(categoryCodes).toContain('tokens:missing-collection-membership')
    expect(categoryCodes).toContain('tokens:missing-mode-value')
    expect(categoryCodes).toContain('tokens:missing-token-alias')
    expect(categoryCodes).toContain('tokens:missing-bound-token')
    expect(categoryCodes).toContain('components:duplicate-variant-combination')
    expect(categoryCodes).toContain('components:missing-variant-value')
    expect(categoryCodes).toContain('spacing:off-base-spacing-value')
    expect(categoryCodes).toContain('typography:text-style-divergence')
    expect(result.summary).toMatchObject({
      variableCount: 2,
      collectionCount: 1,
      componentSetCount: 1,
      spacingValueCount: 2,
      fontFamilyCount: 2,
      textStyleCount: 1
    })
    expect(result.notEvaluated.some((entry) => entry.includes('not a complete'))).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      DESIGN_SYSTEM_AUDIT_LIMITS.reportBytes
    )
  })

  test('marks aggregate collection-reference and issue budgets as partial', async () => {
    const graph = new SceneGraph()
    const collection = graph.createCollection('Dense tokens')
    const variable = graph.createVariable('space', 'FLOAT', collection.id, 4)
    collection.defaultModeId = 'x'.repeat(100_000)
    collection.variableIds = Array.from(
      { length: DESIGN_SYSTEM_AUDIT_LIMITS.collectionVariableReferences + 1 },
      () => variable.id
    )

    const result = await runStaticDesignSystemAudit(editorFor(graph))

    expect(result.truncated).toBe(true)
    expect(result.issueCount).toBeGreaterThan(DESIGN_SYSTEM_AUDIT_LIMITS.issues)
    expect(result.issues).toHaveLength(DESIGN_SYSTEM_AUDIT_LIMITS.issues)
    expect(result.issues.every((issue) => issue.message.length <= 800)).toBe(true)
    expect(result.notEvaluated).toContain('content beyond the static audit resource limits')
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      DESIGN_SYSTEM_AUDIT_LIMITS.reportBytes
    )
  })

  test('rejects an already-cancelled run and yields for cooperative cancellation', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    for (let index = 0; index < DESIGN_SYSTEM_AUDIT_LIMITS.checkpointWork * 3; index += 1) {
      graph.createNode('RECTANGLE', page.id, { name: `Item ${index}` })
    }

    const alreadyCancelled = new AbortController()
    alreadyCancelled.abort()
    await expect(
      runStaticDesignSystemAudit(editorFor(graph), { signal: alreadyCancelled.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })

    const cooperative = new AbortController()
    const audit = runStaticDesignSystemAudit(editorFor(graph), { signal: cooperative.signal })
    setTimeout(() => cooperative.abort(), 0)
    await expect(audit).rejects.toMatchObject({ name: 'AbortError' })
  })
})
