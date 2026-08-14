import { describe, expect, test } from 'bun:test'

import {
  AI_VISUAL_COMPARE_VIEWPORTS,
  commitAIShadowDraft,
  createAIShadowDraftWorkspace,
  forkAIShadowDraftWorkspace,
  runAIShadowVisualComparison,
  sealAIShadowDraft,
  type AIVisualArtifact
} from '@open-pencil/core/ai-draft'
import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

function setup() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('RECTANGLE', page.id, {
    name: 'Live',
    width: 100,
    height: 100
  })
  const editor = createEditor({ graph })
  return { editor, graph, page, node }
}

function artifact(width: number, height: number, byte = 1): AIVisualArtifact {
  return { mediaType: 'image/png', bytes: Uint8Array.of(byte), width, height }
}

function references() {
  return AI_VISUAL_COMPARE_VIEWPORTS.map((viewport) => ({
    viewportId: viewport.id,
    artifact: artifact(viewport.width, viewport.height)
  }))
}

describe('AI shadow drafts', () => {
  test('keeps AI mutations detached and produces stable content addresses', async () => {
    const { editor, graph, page, node } = setup()
    const first = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: editor.state.sceneVersion
    })
    const second = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: editor.state.sceneVersion
    })

    expect(first.graph).not.toBe(graph)
    expect(first.graph.getNode(node.id)).not.toBe(graph.getNode(node.id))
    expect(first.baseDigest).toBe(second.baseDigest)

    first.graph.updateNode(node.id, { name: 'Shadow' })
    expect(graph.getNode(node.id)?.name).toBe('Live')
    const draft = await sealAIShadowDraft(first)
    expect(draft.draftDigest).not.toBe(first.baseDigest)
    expect((await sealAIShadowDraft(first)).draftDigest).toBe(draft.draftDigest)
  })

  test('rejects non-finite numbers before canonical hashing or commit', async () => {
    const { editor, graph, page, node } = setup()
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: editor.state.sceneVersion
    })

    workspace.graph.updateNode(node.id, { width: Number.POSITIVE_INFINITY })

    await expect(sealAIShadowDraft(workspace)).rejects.toThrow('non-finite number')
    expect(graph.getNode(node.id)?.width).toBe(100)
  })

  test('requires exact approval and rejects a changed live revision without mutation', async () => {
    const { editor, graph, page, node } = setup()
    const revision = editor.state.sceneVersion
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: revision
    })
    workspace.graph.updateNode(node.id, { name: 'Shadow' })
    const draft = await sealAIShadowDraft(workspace)

    const unapproved = await commitAIShadowDraft(editor, draft, {
      expectedRevision: revision,
      approval: { approved: true, draftDigest: `${draft.draftDigest}x` }
    })
    expect(unapproved).toMatchObject({ ok: false })
    expect(unapproved.diagnostics[0].code).toBe('approval-required')
    expect(graph.getNode(node.id)?.name).toBe('Live')

    graph.updateNode(node.id, { name: 'Concurrent edit' })
    const conflict = await commitAIShadowDraft(editor, draft, {
      expectedRevision: revision,
      approval: { approved: true, draftDigest: draft.draftDigest }
    })
    expect(conflict).toMatchObject({ ok: false })
    expect(conflict.diagnostics[0].code).toBe('revision-conflict')
    expect(graph.getNode(node.id)?.name).toBe('Concurrent edit')
  })

  test('commits once and one undo restores the exact live document', async () => {
    const { editor, graph, page, node } = setup()
    const revision = editor.state.sceneVersion
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: revision
    })
    workspace.graph.updateNode(node.id, { name: 'Shadow' })
    const draft = await sealAIShadowDraft(workspace)

    const result = await commitAIShadowDraft(editor, draft, {
      expectedRevision: revision,
      approval: { approved: true, draftDigest: draft.draftDigest }
    })
    expect(result.ok).toBe(true)
    expect(editor.graph.getNode(node.id)?.name).toBe('Shadow')
    expect(editor.undo.undoLabel).toBe('AI: Apply shadow draft')

    editor.undo.undo()
    expect(editor.graph.getNode(node.id)?.name).toBe('Live')
    expect(editor.undo.canUndo).toBe(false)
    editor.undo.redo()
    expect(editor.graph.getNode(node.id)?.name).toBe('Shadow')
  })

  test('forks review work without changing the original live authority', async () => {
    const { editor, graph, page, node } = setup()
    const revision = editor.state.sceneVersion
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: revision
    })
    workspace.graph.updateNode(node.id, { name: 'AI draft' })
    const review = forkAIShadowDraftWorkspace(workspace)
    review.graph.updateNode(node.id, { name: 'Reviewed draft' })

    expect(review.graph).not.toBe(workspace.graph)
    expect(workspace.graph.getNode(node.id)?.name).toBe('AI draft')
    expect(review.baseDigest).toBe(workspace.baseDigest)
    expect(review.expectedRevision).toBe(workspace.expectedRevision)

    const draft = await sealAIShadowDraft(review)
    const result = await commitAIShadowDraft(editor, draft, {
      expectedRevision: revision,
      approval: { approved: true, draftDigest: draft.draftDigest }
    })
    expect(result.ok).toBe(true)
    expect(editor.graph.getNode(node.id)?.name).toBe('Reviewed draft')
  })

  test('detects a live in-place mutation even when the editor revision did not advance', async () => {
    const { editor, graph, page, node } = setup()
    const revision = editor.state.sceneVersion
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: revision
    })
    workspace.graph.updateNode(node.id, { name: 'Shadow' })
    const draft = await sealAIShadowDraft(workspace)

    const raw = graph.getNode(node.id)
    if (!raw) throw new Error('fixture node missing')
    raw.name = 'Bypassed event bus'
    expect(editor.state.sceneVersion).toBe(revision)

    const result = await commitAIShadowDraft(editor, draft, {
      expectedRevision: revision,
      approval: { approved: true, draftDigest: draft.draftDigest }
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].code).toBe('revision-conflict')
    expect(graph.getNode(node.id)?.name).toBe('Bypassed event bus')
  })

  test('rolls the live graph back if recording the single undo entry fails', async () => {
    const { editor, graph, page, node } = setup()
    const revision = editor.state.sceneVersion
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: revision
    })
    workspace.graph.updateNode(node.id, { name: 'Shadow' })
    const draft = await sealAIShadowDraft(workspace)
    const failingEditor = {
      get graph() {
        return editor.graph
      },
      state: editor.state,
      undo: editor.undo,
      replaceGraph: editor.replaceGraph,
      pushUndoEntry: () => {
        throw new Error('history unavailable')
      }
    }

    const result = await commitAIShadowDraft(failingEditor, draft, {
      expectedRevision: revision,
      approval: { approved: true, draftDigest: draft.draftDigest }
    })
    expect(result.ok).toBe(false)
    expect(editor.graph.getNode(node.id)?.name).toBe('Live')
    expect(editor.undo.canUndo).toBe(false)
  })
})

describe('AI multi-viewport visual comparison', () => {
  test('captures the fixed 360/768/1280 contract and passes all viewports', async () => {
    const { editor, graph, page } = setup()
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: editor.state.sceneVersion
    })
    const captured: string[] = []
    const result = await runAIShadowVisualComparison({
      workspace,
      references: references(),
      captureBackend: {
        capture: async ({ viewport }) => {
          captured.push(`${viewport.width}x${viewport.height}`)
          return artifact(viewport.width, viewport.height)
        }
      },
      comparator: { compare: async () => ({ differenceRatio: 0 }) }
    })

    expect(result.status).toBe('passed')
    expect(captured).toEqual(['360x800', '768x1024', '1280x800'])
    expect(result.rounds).toHaveLength(1)
    expect(result.repairRounds).toBe(0)
  })

  test('allows at most two repairs and keeps them on the shadow graph', async () => {
    const { editor, graph, page, node } = setup()
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: editor.state.sceneVersion
    })
    let repairs = 0
    const result = await runAIShadowVisualComparison({
      workspace,
      references: references(),
      captureBackend: {
        capture: async ({ viewport, round }) => artifact(viewport.width, viewport.height, round + 1)
      },
      comparator: { compare: async ({ round }) => ({ differenceRatio: round === 2 ? 0 : 1 }) },
      repair: ({ graph: shadow }) => {
        repairs++
        shadow.updateNode(node.id, { name: `Repair ${repairs}` })
      }
    })

    expect(result.status).toBe('passed')
    expect(result.rounds).toHaveLength(3)
    expect(result.repairRounds).toBe(2)
    expect(repairs).toBe(2)
    expect(graph.getNode(node.id)?.name).toBe('Live')
    expect(workspace.graph.getNode(node.id)?.name).toBe('Repair 2')
  })

  test('fails closed on artifact and pixel budgets with bounded diagnostics', async () => {
    const { editor, graph, page } = setup()
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: editor.state.sceneVersion
    })
    const result = await runAIShadowVisualComparison({
      workspace,
      references: references(),
      captureBackend: {
        capture: async ({ viewport }) => artifact(viewport.width, viewport.height)
      },
      comparator: { compare: async () => ({ differenceRatio: 1 }) },
      budget: { maxTotalPixels: 1, maxDiagnostics: 1 }
    })

    expect(result.status).toBe('budget-exhausted')
    expect(result.rounds).toHaveLength(0)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].code).toBe('pixel-budget-exceeded')
  })

  test('rejects repair budgets above the hard two-round ceiling', async () => {
    const { editor, graph, page } = setup()
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: editor.state.sceneVersion
    })
    const result = await runAIShadowVisualComparison({
      workspace,
      references: references(),
      captureBackend: {
        capture: async ({ viewport }) => artifact(viewport.width, viewport.height)
      },
      comparator: { compare: async () => ({ differenceRatio: 0 }) },
      budget: { maxRepairRounds: 3 }
    })

    expect(result.status).toBe('failed')
    expect(result.diagnostics[0].code).toBe('invalid-input')
  })

  test('isolates comparator byte mutations from reported artifacts', async () => {
    const { editor, graph, page } = setup()
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: editor.state.sceneVersion
    })
    const result = await runAIShadowVisualComparison({
      workspace,
      references: references(),
      captureBackend: {
        capture: async ({ viewport }) => artifact(viewport.width, viewport.height)
      },
      comparator: {
        compare: async ({ reference, candidate }) => {
          reference.bytes[0] = 99
          candidate.bytes[0] = 99
          return { differenceRatio: 0 }
        }
      }
    })

    expect(result.status).toBe('passed')
    expect(result.rounds[0].comparisons[0].reference.bytes[0]).toBe(1)
    expect(result.rounds[0].comparisons[0].candidate.bytes[0]).toBe(1)
  })

  test('does not let a timed-out repair mutate the workspace later', async () => {
    const { editor, graph, page, node } = setup()
    const workspace = await createAIShadowDraftWorkspace({
      graph,
      pageId: page.id,
      expectedRevision: editor.state.sceneVersion
    })
    const result = await runAIShadowVisualComparison({
      workspace,
      references: references(),
      captureBackend: {
        capture: async ({ viewport }) => artifact(viewport.width, viewport.height)
      },
      comparator: { compare: async () => ({ differenceRatio: 1 }) },
      repair: ({ graph: staged }) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            staged.updateNode(node.id, { name: 'Late repair' })
            resolve()
          }, 50)
        }),
      budget: { maxDurationMs: 20 }
    })

    expect(result.status).toBe('budget-exhausted')
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 60)
    })
    expect(workspace.graph.getNode(node.id)?.name).toBe('Live')
    expect(graph.getNode(node.id)?.name).toBe('Live')
  })
})
