import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §23 — named lucide-react icons. A node carrying
 * `interactiveProps.icon` emits a lucide component import instead of requiring
 * path geometry, while unknown icon names fall back to normal node emission.
 */
describe('compile — lucide icons (Phase 4 §23)', () => {
  function compileIcon(interactiveProps: Record<string, unknown>) {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      name: 'Icon',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      interactiveProps
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'lucide-demo' })
    })
    return {
      app: out.files.get('src/App.tsx') as string,
      pkg: JSON.parse(out.files.get('package.json') as string) as {
        dependencies: Record<string, string>
      },
      warnings: out.warnings
    }
  }

  test('emits a named lucide component with package dependency', () => {
    const { app, pkg } = compileIcon({
      icon: { name: 'camera', size: 20, color: '#334455', strokeWidth: 1.5, ariaLabel: 'Photo' }
    })

    expect(pkg.dependencies['lucide-react']).toBe('^1.21.0')
    expect(app).toContain("import { Camera } from 'lucide-react'")
    expect(app).toContain('<Camera')
    expect(app).toContain('size={20}')
    expect(app).toContain('color="#334455"')
    expect(app).toContain('strokeWidth={1.5}')
    expect(app).toContain('role="img"')
    expect(app).toContain('aria-label="Photo"')
  })

  test('normalizes lucide prefix and PascalCase names', () => {
    const prefixed = compileIcon({ icon: 'lucide:camera-off' })
    const pascal = compileIcon({ icon: { name: 'CameraOff' } })

    expect(prefixed.app).toContain("import { CameraOff } from 'lucide-react'")
    expect(prefixed.app).toContain('<CameraOff')
    expect(pascal.app).toContain("import { CameraOff } from 'lucide-react'")
    expect(pascal.app).toContain('<CameraOff')
  })

  test('unknown icon warns and leaves a normal element', () => {
    const { app, pkg, warnings } = compileIcon({ icon: 'not-a-real-lucide-icon' })

    expect(warnings.map((w) => w.code)).toContain('lucide-icon-unknown')
    expect(pkg.dependencies['lucide-react']).toBeUndefined()
    expect(app).not.toContain("from 'lucide-react'")
    expect(app).toContain('<div')
  })
})
