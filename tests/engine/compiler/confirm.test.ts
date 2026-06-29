import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { ActionDef, SceneGraph } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §10 v3 — end-to-end confirm + clipboard wiring. A `confirm` action
 * emits the `_lowcode_confirm.tsx` runtime, imports `__opConfirm` in the page,
 * mounts `<ConfirmHost/>` in main.tsx, and seeds the modal's Tailwind classes
 * into the safelist. A `clipboard` action emits `navigator.clipboard.writeText`
 * inline with NO runtime file / import / dependency. Neither present →
 * byte-identical to a plain compile.
 */
function compileWithClick(onClick: ActionDef[]) {
  const graph: SceneGraph = makeSceneGraph('Dialoger')
  const pageId = firstPageId(graph)
  const btn = graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Go' } })
  btn.events = { onClick }
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'confirm-app' })
  })
}

describe('compile — confirm runtime wiring (Phase 3 §10 v3)', () => {
  test('a confirm action emits the runtime + import + mount + safelist', () => {
    const out = compileWithClick([
      {
        id: 'cf',
        kind: 'confirm',
        messageExpr: '"Delete this?"',
        consequent: [{ id: 'n', kind: 'navigate', to: '/gone' }]
      }
    ])

    // runtime file
    const runtime = out.files.get('src/_lowcode_confirm.tsx') as string
    expect(runtime).toBeDefined()
    expect(runtime).toContain('export function __opConfirm')
    expect(runtime).toContain('export function ConfirmHost')
    expect(runtime).toContain('useSyncExternalStore')
    expect(runtime).toContain('Promise<boolean>')
    expect(runtime).not.toContain('Math.random')
    expect(runtime).toContain('border border-border bg-background')
    expect(runtime).toContain('text-foreground')
    expect(runtime).toContain('bg-primary px-4 py-2 text-sm text-primary-foreground')
    expect(runtime).not.toContain('bg-white')
    expect(runtime).not.toContain('bg-blue-600')
    expect(runtime).not.toContain('text-white')

    // page imports + awaits the prompter
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import { __opConfirm } from './_lowcode_confirm'")
    expect(app).toContain('if (await __opConfirm("Delete this?")) { navigate("/gone"); }')

    // main.tsx mounts ConfirmHost
    const main = out.files.get('src/main.tsx') as string
    expect(main).toContain("import { ConfirmHost } from './_lowcode_confirm'")
    expect(main).toContain('<ConfirmHost />')

    // the modal's classes reach the Tailwind safelist
    const css = out.files.get('src/index.css') as string
    expect(css).toContain('bg-foreground/40')
    expect(css).toContain('bg-background')
    expect(css).toContain('text-primary-foreground')
    expect(css).toContain('@theme inline')
    expect(css).toContain('--color-foreground')
    expect(css).not.toContain('bg-blue-600')
    expect(css).not.toContain('bg-black/40')
    expect(css).toContain('shadow-xl')

    // no new npm dependency
    expect(out.files.get('package.json') as string).not.toContain('react-modal')
  })

  test('no confirm → no runtime, no ConfirmHost (byte-identical path)', () => {
    const out = compileWithClick([{ id: 'n', kind: 'navigate', to: '/next' }])
    expect(out.files.has('src/_lowcode_confirm.tsx')).toBe(false)
    const main = out.files.get('src/main.tsx') as string
    expect(main).not.toContain('ConfirmHost')
    expect(out.files.get('src/App.tsx') as string).not.toContain('__opConfirm')
  })

  test('a clipboard action emits writeText inline with no runtime / import / dep', () => {
    const out = compileWithClick([{ id: 'cb', kind: 'clipboard', valueExpr: '"https://x.y"' }])

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('navigator.clipboard.writeText("https://x.y")')
    expect(app).not.toContain('__opConfirm')
    // clipboard has no runtime surface
    expect(out.files.has('src/_lowcode_confirm.tsx')).toBe(false)
    const main = out.files.get('src/main.tsx') as string
    expect(main).not.toContain('ConfirmHost')
  })

  test('a confirm nested in a condition branch still wires the runtime + import', () => {
    const out = compileWithClick([
      {
        id: 'c',
        kind: 'condition',
        condExpr: '1 === 1',
        consequent: [
          {
            id: 'cf',
            kind: 'confirm',
            messageExpr: '"Sure?"',
            consequent: [{ id: 's', kind: 'stop' }]
          }
        ]
      }
    ])
    expect(out.files.has('src/_lowcode_confirm.tsx')).toBe(true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import { __opConfirm } from './_lowcode_confirm'")
    expect(app).toContain('if (await __opConfirm("Sure?")) { return; }')
  })

  // ── Phase 3 §10 v5: custom button labels ──

  test('custom confirm labels emit options + the runtime renders them', () => {
    const out = compileWithClick([
      {
        id: 'cf',
        kind: 'confirm',
        messageExpr: '"删除?"',
        consequent: [{ id: 's', kind: 'stop' }],
        confirmLabel: '删除',
        cancelLabel: '保留'
      }
    ])
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(
      'await __opConfirm("删除?", { confirmLabel: "删除", cancelLabel: "保留" })'
    )

    const runtime = out.files.get('src/_lowcode_confirm.tsx') as string
    // runtime renders the per-confirm labels (default 'OK' / 'Cancel' when absent)
    expect(runtime).toContain('{active.confirmLabel}')
    expect(runtime).toContain('{active.cancelLabel}')
    expect(runtime).toContain("options.confirmLabel ?? 'OK'")
    expect(runtime).toContain("options.cancelLabel ?? 'Cancel'")
  })
})
