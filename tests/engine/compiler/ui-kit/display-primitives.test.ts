import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneGraph } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §22 — shadcn display primitives. Authored nodes can opt into
 * display-only kit components through `interactiveProps.uiKit.primitive`.
 * Plain emit ignores the hint entirely.
 */

function compileWith(graph: SceneGraph, pageId: string, uiKit?: 'shadcn') {
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'display-primitives', ...(uiKit ? { uiKit } : {}) })
  })
}

describe('compile — shadcn display primitives (Phase 4 §22)', () => {
  test('Badge/Alert/Separator/Skeleton map to kit imports, files and deps', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const badge = graph.createNode('FRAME', pageId, {
      name: 'Status',
      interactiveProps: { uiKit: { primitive: 'badge', variant: 'secondary' } }
    })
    graph.createNode('TEXT', badge.id, { text: 'Draft' })
    const alert = graph.createNode('FRAME', pageId, {
      name: 'Warning',
      interactiveProps: { uiKit: { primitive: 'alert', variant: 'destructive' } }
    })
    graph.createNode('TEXT', alert.id, { text: 'Check your input' })
    graph.createNode('FRAME', pageId, {
      name: 'Line',
      interactiveProps: { uiKit: { primitive: 'separator' } }
    })
    graph.createNode('FRAME', pageId, {
      name: 'Loading',
      interactiveProps: { uiKit: { primitive: 'skeleton' } }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(`import { Alert } from '@/components/ui/alert'`)
    expect(app).toContain(`import { Badge } from '@/components/ui/badge'`)
    expect(app).toContain(`import { Separator } from '@/components/ui/separator'`)
    expect(app).toContain(`import { Skeleton } from '@/components/ui/skeleton'`)
    expect(app).toContain('<Badge')
    expect(app).toContain('variant="secondary"')
    expect(app).toContain('Draft')
    expect(app).toContain('<Alert')
    expect(app).toContain('variant="destructive"')
    expect(app).toContain('Check your input')
    expect(app).toContain('<Separator')
    expect(app).toContain('<Skeleton')

    expect(out.files.has('src/components/ui/badge.tsx')).toBe(true)
    expect(out.files.has('src/components/ui/alert.tsx')).toBe(true)
    expect(out.files.has('src/components/ui/separator.tsx')).toBe(true)
    expect(out.files.has('src/components/ui/skeleton.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('class-variance-authority')
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-separator')
    expect(pkg.dependencies).not.toHaveProperty('@radix-ui/react-progress')
    expect(pkg.dependencies).not.toHaveProperty('@radix-ui/react-avatar')
    expect(out.warnings).toEqual([])
  })

  test('Progress emits a composed value prop and Radix progress dependency', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      interactiveProps: { uiKit: { primitive: 'progress', value: 42 } }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(`import { Progress } from '@/components/ui/progress'`)
    expect(app).toContain('<Progress')
    expect(app).toContain('value={42}')
    expect(out.files.has('src/components/ui/progress.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-progress')
    expect(out.warnings).toEqual([])
  })

  test('Avatar emits image/fallback composition and Radix avatar dependency', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      interactiveProps: {
        uiKit: {
          primitive: 'avatar',
          src: 'https://example.com/a.png',
          alt: 'Ada',
          fallback: 'AD'
        }
      }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(
      `import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'`
    )
    expect(app).toContain('<Avatar')
    expect(app).toContain('<AvatarImage src="https://example.com/a.png" alt="Ada" />')
    expect(app).toContain('<AvatarFallback>{"AD"}</AvatarFallback>')
    expect(out.files.has('src/components/ui/avatar.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-avatar')
    expect(out.warnings).toEqual([])
  })

  test('Tabs emits composed triggers/content and Radix tabs dependency', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      interactiveProps: {
        uiKit: {
          primitive: 'tabs',
          defaultValue: 'overview',
          items: [
            { value: 'overview', label: 'Overview', content: 'Project overview' },
            { value: 'settings', label: 'Settings', content: 'Project settings' }
          ]
        }
      }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(
      `import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'`
    )
    expect(app).toContain('<Tabs')
    expect(app).toContain('defaultValue="overview"')
    expect(app).toContain('<TabsList>')
    expect(app).toContain('<TabsTrigger value="settings">Settings</TabsTrigger>')
    expect(app).toContain('<TabsContent value="overview">')
    expect(app).toContain('{"Project overview"}')
    expect(out.files.has('src/components/ui/tabs.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-tabs')
    expect(out.warnings).toEqual([])
  })

  test('Tabs can bind active value to writable page state', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(pageId, {
      state: [{ id: 's-active', name: 'activeTab', type: 'string', defaultValue: 'overview' }]
    })
    graph.createNode('FRAME', pageId, {
      interactiveProps: {
        uiKit: {
          primitive: 'tabs',
          valueBinding: { kind: 'ref', stateId: 's-active' },
          items: [
            { value: 'overview', label: 'Overview', content: 'Project overview' },
            { value: 'settings', label: 'Settings', content: 'Project settings' }
          ]
        }
      }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain('const [activeTab, setActiveTab] = useState("overview")')
    expect(app).toContain('value={activeTab}')
    expect(app).toContain('onValueChange={(value) => setActiveTab(value)}')
    expect(app).not.toContain('defaultValue="overview"')
    expect(out.warnings).toEqual([])
  })

  test('Accordion emits composed items and Radix accordion dependency', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      interactiveProps: {
        uiKit: {
          primitive: 'accordion',
          defaultValue: 'shipping',
          items: [
            { value: 'shipping', title: 'Shipping', content: 'Ships in two days' },
            { value: 'returns', title: 'Returns', content: 'Thirty day returns' }
          ]
        }
      }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(
      `import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'`
    )
    expect(app).toContain('<Accordion')
    expect(app).toContain('type="single"')
    expect(app).toContain('collapsible')
    expect(app).toContain('defaultValue="shipping"')
    expect(app).toContain('<AccordionItem value="returns">')
    expect(app).toContain('<AccordionTrigger>Returns</AccordionTrigger>')
    expect(app).toContain('{"Thirty day returns"}')
    expect(out.files.has('src/components/ui/accordion.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-accordion')
    expect(out.warnings).toEqual([])
  })

  test('Accordion multiple can bind open values to document state array', () => {
    const graph = makeSceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd-open', name: 'openSections', type: 'array', defaultValue: ['shipping'] }
      ]
    })
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      interactiveProps: {
        uiKit: {
          primitive: 'accordion',
          type: 'multiple',
          valueBinding: { kind: 'docState', docStateName: 'openSections' },
          items: [
            { value: 'shipping', title: 'Shipping', content: 'Ships in two days' },
            { value: 'returns', title: 'Returns', content: 'Thirty day returns' }
          ]
        }
      }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(`import { useDocState, setDocState } from './_lowcode_state'`)
    expect(app).toContain(`const openSections = useDocState("openSections")`)
    expect(app).toContain('type="multiple"')
    expect(app).toContain('value={openSections}')
    expect(app).toContain('onValueChange={(value) => setDocState("openSections", value)}')
    expect(app).not.toContain('defaultValue=')
    expect(out.warnings).toEqual([])
  })

  test('Tabs valueBinding rejects non-string state and falls back to defaultValue', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(pageId, {
      state: [{ id: 's-open', name: 'openSections', type: 'array', defaultValue: [] }]
    })
    graph.createNode('FRAME', pageId, {
      interactiveProps: {
        uiKit: {
          primitive: 'tabs',
          defaultValue: 'overview',
          valueBinding: { kind: 'ref', stateId: 's-open' },
          items: [{ value: 'overview', label: 'Overview', content: 'Project overview' }]
        }
      }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain('defaultValue="overview"')
    expect(app).not.toContain('value={openSections}')
    expect(out.warnings.map((w) => w.code)).toContain('ui-kit-primitive-binding-bad-state-type')
  })

  test('no uiKit keeps primitive hints on the plain Tailwind path', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      interactiveProps: { uiKit: { primitive: 'badge', variant: 'secondary' } }
    })

    const out = compileWith(graph, pageId)
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain('<div')
    expect(app).not.toContain('<Badge')
    expect(app).not.toContain('variant="secondary"')
    expect(app).not.toContain('@/components/ui')
    expect(out.files.has('src/components/ui/badge.tsx')).toBe(false)
  })

  test('unknown primitives warn and fall back to normal element emit', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      interactiveProps: { uiKit: { primitive: 'toast' } }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain('<div')
    expect(app).not.toContain('@/components/ui')
    expect(out.warnings.map((w) => w.code)).toContain('ui-kit-primitive-unknown')
  })

  test('Tabs/Accordion without valid items warn and fall back to normal element emit', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      interactiveProps: { uiKit: { primitive: 'tabs', items: [] } }
    })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain('<div')
    expect(app).not.toContain('@/components/ui/tabs')
    expect(out.warnings.map((w) => w.code)).toContain('ui-kit-primitive-items-invalid')
  })
})
