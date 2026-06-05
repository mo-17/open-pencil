import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneGraph } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §15 — code UI-kit adapter (shadcn/ui). When `uiKit: 'shadcn'` is set,
 * interactive design nodes (BUTTON / text INPUT / TEXTAREA / LABEL) are emitted
 * as the kit's React components with the design classes passed through via
 * `className`; the kit's component sources, deps and Tailwind v4 theme are
 * inlined. Default (unset) → byte-identical to the self-contained Tailwind emit.
 */

function compileWith(graph: SceneGraph, pageId: string, uiKit?: 'shadcn') {
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'kit-app', ...(uiKit ? { uiKit } : {}) })
  })
}

describe('compile — shadcn UI kit (Phase 3 §15)', () => {
  test('BUTTON emits <Button> + import + inlined component sources + deps + theme', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Save' } })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(`import { Button } from '@/components/ui/button'`)
    expect(app).toContain('<Button')
    expect(app).not.toContain('<button')
    // text passes through as the child
    expect(app).toContain('Save')

    // inlined kit sources
    expect(out.files.has('src/components/ui/button.tsx')).toBe(true)
    expect(out.files.has('src/lib/utils.ts')).toBe(true)
    expect(out.files.has('components.json')).toBe(true)

    // deps: base + button's radix/cva
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('clsx')
    expect(pkg.dependencies).toHaveProperty('tailwind-merge')
    expect(pkg.dependencies).toHaveProperty('class-variance-authority')
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-slot')

    // theme tokens + @/ alias wiring
    const css = out.files.get('src/index.css') as string
    expect(css).toContain('@theme inline')
    expect(css).toContain('--color-primary')
    const tsconfig = JSON.parse(out.files.get('tsconfig.json') as string)
    expect(tsconfig.compilerOptions.paths).toEqual({ '@/*': ['./src/*'] })
    const vite = out.files.get('vite.config.ts') as string
    expect(vite).toContain(`'@': fileURLToPath(new URL('./src', import.meta.url))`)
  })

  test('text INPUT maps to <Input> (only base deps, no radix-slot/cva)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('INPUT', pageId, { interactiveProps: { placeholder: 'Email' } })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(`import { Input } from '@/components/ui/input'`)
    expect(app).toContain('<Input')
    expect(out.files.has('src/components/ui/input.tsx')).toBe(true)
    // Input pulls no cva / radix-slot — only the always-present cn deps.
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('clsx')
    expect(pkg.dependencies).not.toHaveProperty('class-variance-authority')
    expect(pkg.dependencies).not.toHaveProperty('@radix-ui/react-slot')
  })

  test('CHECKBOX (type="checkbox") stays a plain <input>, no Input.tsx', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('CHECKBOX', pageId, { interactiveProps: { label: 'Agree' } })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<input')
    expect(app).not.toContain('<Input')
    expect(out.files.has('src/components/ui/input.tsx')).toBe(false)
  })

  test('TEXTAREA maps to <Textarea>', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('TEXTAREA', pageId, { interactiveProps: { placeholder: 'Notes' } })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(`import { Textarea } from '@/components/ui/textarea'`)
    expect(app).toContain('<Textarea')
    expect(out.files.has('src/components/ui/textarea.tsx')).toBe(true)
  })

  test('only the used components are inlined (BUTTON-only doc has no input/textarea)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Go' } })

    const out = compileWith(graph, pageId, 'shadcn')
    expect(out.files.has('src/components/ui/button.tsx')).toBe(true)
    expect(out.files.has('src/components/ui/input.tsx')).toBe(false)
    expect(out.files.has('src/components/ui/textarea.tsx')).toBe(false)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).not.toHaveProperty('@radix-ui/react-label')
  })

  test('no uiKit → byte-identical to the plain Tailwind emit', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Save' } })

    const off = compileWith(graph, pageId)
    const app = off.files.get('src/App.tsx') as string
    expect(app).toContain('<button')
    expect(app).not.toContain('@/components/ui')
    expect(off.files.has('src/components/ui/button.tsx')).toBe(false)
    expect(off.files.has('src/lib/utils.ts')).toBe(false)
    expect(off.files.has('components.json')).toBe(false)
    const css = off.files.get('src/index.css') as string
    expect(css).not.toContain('@theme inline')
    const pkg = JSON.parse(off.files.get('package.json') as string)
    expect(pkg.dependencies).not.toHaveProperty('clsx')
    expect(pkg.dependencies).not.toHaveProperty('class-variance-authority')
    // tsconfig/vite stay alias-free
    const tsconfig = JSON.parse(off.files.get('tsconfig.json') as string)
    expect(tsconfig.compilerOptions).not.toHaveProperty('paths')
    const vite = off.files.get('vite.config.ts') as string
    expect(vite).not.toContain('resolve:')
  })

  test('--ui-kit on a doc with no interactive node stays byte-identical (nothing emitted)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, { name: 'Box', width: 100, height: 100 })

    const on = compileWith(graph, pageId, 'shadcn')
    const off = compileWith(graph, pageId)
    expect(on.files.has('src/lib/utils.ts')).toBe(false)
    expect(on.files.has('components.json')).toBe(false)
    expect(on.files.get('src/index.css')).toEqual(off.files.get('src/index.css'))
    expect(on.files.get('tsconfig.json')).toEqual(off.files.get('tsconfig.json'))
    expect(on.files.get('package.json')).toEqual(off.files.get('package.json'))
  })
})
