import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { ActionDef, SceneGraph, WorkflowDef } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §10 v4 — end-to-end named WorkflowDef: a document-level workflow is
 * expanded INLINE at each `callWorkflow` site, so the emitted page contains the
 * workflow's statements directly and all the downstream wiring (toast runtime,
 * `__opToast` import, `<ToastHost/>` mount) fires off the *expanded* handlers —
 * exactly as if the actions had been authored on the button. No emitted
 * workflow function, no runtime workflow file.
 */
function compileWithWorkflows(onClick: ActionDef[], workflows: WorkflowDef[], docState?: string) {
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

describe('compile — workflow parameters (Phase 3 §10 v6)', () => {
  test('a callWorkflow arg is substituted into the inlined workflow body', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify', args: { msg: '"Saved!"' } }],
      [
        {
          id: 'notify',
          name: 'Notify',
          params: ['msg'],
          actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }]
        }
      ]
    )
    const app = out.files.get('src/App.tsx') as string
    // the formal parameter `msg` is replaced by the caller's literal argument
    expect(app).toContain('__opToast("Saved!")')
    expect(app).not.toContain('__opToast(msg)')
  })

  test('an arg referencing a docState resolves against the caller runtime', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify', args: { msg: 'status' } }],
      [
        {
          id: 'notify',
          name: 'Notify',
          params: ['msg'],
          actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }]
        }
      ],
      'status'
    )
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('__opToast(status)')
    // the docState behind the argument is read in by the caller page
    expect(app).toContain('useDocState("status")')
  })

  test('a missing argument drops the callWorkflow (no toast emitted)', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify' }],
      [
        {
          id: 'notify',
          name: 'Notify',
          params: ['msg'],
          actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }]
        }
      ]
    )
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('__opToast')
  })
})

describe('compile — workflow default arguments (Phase 3 §10 v7)', () => {
  const notify: WorkflowDef = {
    id: 'notify',
    name: 'Notify',
    params: ['msg'],
    paramDefaults: { msg: '"Done"' },
    actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }]
  }

  test('an omitted arg falls back to the workflow default expression', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify' }],
      [notify]
    )
    const app = out.files.get('src/App.tsx') as string
    // no longer dropped — the default `"Done"` is substituted for `msg`
    expect(app).toContain('__opToast("Done")')
    expect(app).not.toContain('__opToast(msg)')
  })

  test('an explicit arg overrides the default', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify', args: { msg: '"Custom"' } }],
      [notify]
    )
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('__opToast("Custom")')
    expect(app).not.toContain('__opToast("Done")')
  })

  test('a parameter with neither arg nor default still drops the callWorkflow', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify' }],
      [
        {
          id: 'notify',
          name: 'Notify',
          params: ['msg', 'extra'],
          paramDefaults: { msg: '"Done"' },
          actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }]
        }
      ]
    )
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('__opToast')
  })
})

describe('compile — workflow optional parameters (Phase 3 §10 v8)', () => {
  test('an omitted optional parameter resolves to undefined (not dropped)', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify' }],
      [
        {
          id: 'notify',
          name: 'Notify',
          params: ['msg'],
          optionalParams: ['msg'],
          actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }]
        }
      ]
    )
    const app = out.files.get('src/App.tsx') as string
    // not dropped — the omitted optional `msg` is substituted with `undefined`
    expect(app).toContain('__opToast(undefined)')
    expect(app).not.toContain('__opToast(msg)')
  })

  test('an explicit arg still wins over an optional parameter', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify', args: { msg: '"Hi"' } }],
      [
        {
          id: 'notify',
          name: 'Notify',
          params: ['msg'],
          optionalParams: ['msg'],
          actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }]
        }
      ]
    )
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('__opToast("Hi")')
    expect(app).not.toContain('__opToast(undefined)')
  })

  test('a required parameter still drops the call even when another is optional', () => {
    const out = compileWithWorkflows(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify' }],
      [
        {
          id: 'notify',
          name: 'Notify',
          params: ['msg', 'other'],
          optionalParams: ['other'],
          actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }]
        }
      ]
    )
    const app = out.files.get('src/App.tsx') as string
    // `msg` is required (not in optionalParams, no default) → whole call dropped
    expect(app).not.toContain('__opToast')
  })
})
