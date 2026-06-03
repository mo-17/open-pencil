import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { ActionDef, SceneGraph } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §10 v2 — end-to-end toast wiring: a `toast` action emits the
 * `_lowcode_toast.tsx` runtime, imports `__opToast` in the page, mounts
 * `<ToastHost/>` in main.tsx, and seeds the toast's Tailwind classes into the
 * safelist. No toast → none of that (byte-identical to a non-toast compile).
 */
function compileWithClick(onClick: ActionDef[]) {
  const graph: SceneGraph = makeSceneGraph('Toaster')
  const pageId = firstPageId(graph)
  const btn = graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Save' } })
  btn.events = { onClick }
  return compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'toast-app' }) })
}

describe('compile — toast runtime wiring (Phase 3 §10 v2)', () => {
  test('a toast action emits the runtime + import + mount + safelist', () => {
    const out = compileWithClick([
      { id: 't', kind: 'toast', messageExpr: '"Saved"', variant: 'success' }
    ])

    // runtime file
    const runtime = out.files.get('src/_lowcode_toast.tsx') as string
    expect(runtime).toBeDefined()
    expect(runtime).toContain('export function __opToast')
    expect(runtime).toContain('export function ToastHost')
    expect(runtime).toContain('useSyncExternalStore')
    expect(runtime).not.toContain('Math.random') // id via module counter, not random

    // page imports + calls the pusher
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import { __opToast } from './_lowcode_toast'")
    expect(app).toContain('__opToast("Saved", "success")')

    // main.tsx mounts ToastHost
    const main = out.files.get('src/main.tsx') as string
    expect(main).toContain("import { ToastHost } from './_lowcode_toast'")
    expect(main).toContain('<ToastHost />')

    // the toast's classes reach the Tailwind safelist
    const css = out.files.get('src/index.css') as string
    expect(css).toContain('bg-green-600')
    expect(css).toContain('fixed')

    // no new npm dependency
    expect(out.files.get('package.json') as string).not.toContain('react-toastify')
  })

  test('no toast → no runtime, no ToastHost (byte-identical path)', () => {
    const out = compileWithClick([
      { id: 'n', kind: 'navigate', to: '/next' } // a non-toast action
    ])
    expect(out.files.has('src/_lowcode_toast.tsx')).toBe(false)
    const main = out.files.get('src/main.tsx') as string
    expect(main).not.toContain('ToastHost')
    expect(out.files.get('src/App.tsx') as string).not.toContain('__opToast')
  })

  test('a toast nested in a condition branch still wires the runtime + import', () => {
    const out = compileWithClick([
      {
        id: 'c',
        kind: 'condition',
        condExpr: '1 === 1',
        consequent: [{ id: 't', kind: 'toast', messageExpr: '"Hi"' }]
      }
    ])
    expect(out.files.has('src/_lowcode_toast.tsx')).toBe(true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import { __opToast } from './_lowcode_toast'")
    expect(app).toContain('__opToast("Hi")') // default info → no second arg
  })

  // ── Phase 3 §10 v5: configurable position + duration ──

  test('a positioned toast emits options + the runtime maps every position + seeds the safelist', () => {
    const out = compileWithClick([
      {
        id: 't',
        kind: 'toast',
        messageExpr: '"Saved"',
        variant: 'success',
        position: 'top-center',
        durationMs: 5000
      }
    ])
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('__opToast("Saved", "success", { position: "top-center", durationMs: 5000 })')

    const runtime = out.files.get('src/_lowcode_toast.tsx') as string
    expect(runtime).toContain('POSITION_CLASSES')
    expect(runtime).toContain("'top-center': 'top-4 left-1/2 -translate-x-1/2'")
    expect(runtime).toContain('options.durationMs ?? 3000')
    // grouped rendering — one fixed container per active position
    expect(runtime).toContain('new Set(active.map((t) => t.position))')

    // position classes reach the Tailwind safelist
    const css = out.files.get('src/index.css') as string
    expect(css).toContain('top-4')
    expect(css).toContain('-translate-x-1/2')
  })
})
