import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { ActionDef, SceneGraph, WorkflowDef } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §10 v4 — end-to-end named WorkflowDef: a document-level workflow is
 * expanded INLINE at each `callWorkflow` site, so the emitted page contains the
 * workflow's statements directly and all the downstream wiring (toast runtime,
 * `__opToast` import, `<ToastHost/>` mount) fires off the *expanded* handlers —
 * exactly as if the actions had been authored on the button. No emitted
 * workflow function, no runtime workflow file.
 */
function compileWithWorkflows(
  onClick: ActionDef[],
  workflows: WorkflowDef[],
  docState?: string
) {
  const graph: SceneGraph = makeSceneGraph('Flows')
  graph.updateNode(graph.rootId, {
    lowcodeWorkflows: workflows,
    ...(docState
      ? { lowcodeDocumentState: [{ id: 'd1', name: docState, type: 'number', defaultValue: 0 }] }
      : {})
  })
  const pageId = firstPageId(graph)
  const btn = graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Save' } })
  btn.events = { onClick }
  return compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'flow-app' }) })
}

describe('compile — named WorkflowDef inline expansion (Phase 3 §10 v4)', () => {
  test('callWorkflow inlines the workflow body + fires downstream wiring', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wf-save' }],
      [
        {
          id: 'wf-save',
          name: 'Save & toast',
          actions: [
            { id: 't1', kind: 'toast', messageExpr: '"Saving"' },
            { id: 't2', kind: 'toast', messageExpr: '"Saved"', variant: 'success' }
          ]
        }
      ]
    )

    const app = out.files.get('src/App.tsx') as string
    // both of the workflow's toasts are inlined into the one onClick handler,
    // proving the chain (not just the first action) is spliced in
    expect(app).toContain('__opToast("Saving")')
    expect(app).toContain('__opToast("Saved", "success")')
    // the import gate fired on the expanded toast handlers
    expect(app).toContain("import { __opToast } from './_lowcode_toast'")

    // toast runtime + ToastHost mount, exactly as if authored inline
    expect(out.files.has('src/_lowcode_toast.tsx')).toBe(true)
    const main = out.files.get('src/main.tsx') as string
    expect(main).toContain('<ToastHost />')

    // no emitted workflow function / runtime file — pure inline expansion
    expect(out.files.has('src/_lowcode_workflows.tsx')).toBe(false)
  })

  test('a docState write inside a called workflow emits setDocState through the caller', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wf' }],
      [
        {
          id: 'wf',
          name: 'bump',
          actions: [{ id: 's', kind: 'setVariable', targetName: 'count', valueExpr: '$prev + 1' }]
        }
      ],
      'count'
    )
    const app = out.files.get('src/App.tsx') as string
    // the inlined setVariable resolves against the caller's doc-state runtime
    expect(app).toContain('setDocState("count", (prev) => prev + 1)')
    expect(app).toContain('setDocState')
  })

  test('no callWorkflow / no workflows → byte-identical (no workflow artifacts)', () => {
    const out = compileWithWorkflows([{ id: 'n', kind: 'navigate', to: '/next' }], [])
    expect(out.files.has('src/_lowcode_workflows.tsx')).toBe(false)
    expect(out.files.has('src/_lowcode_toast.tsx')).toBe(false)
    expect(out.files.get('src/App.tsx') as string).not.toContain('__opToast')
  })
})
