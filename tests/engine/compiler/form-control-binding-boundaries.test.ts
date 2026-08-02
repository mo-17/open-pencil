import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { planValidatedFormValueBindings } from '@open-pencil/core/lowcode-validation'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

describe('compile — validated form binding boundaries', () => {
  test('component-master page-state binding warns instead of emitting validation glue', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(pageId, {
      state: [{ id: 'email-state', name: 'email', type: 'string', defaultValue: '' }]
    })
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Unsupported Field',
      width: 240,
      height: 80
    })
    graph.createNode('INPUT', master.id, {
      name: 'Email input',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'ref', stateId: 'email-state' } },
      interactiveProps: { validation: { required: true } }
    })
    graph.createInstance(master.id, pageId)

    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const component = out.files.get('src/components/UnsupportedField.tsx') as string
    const warningCodes = out.warnings.map((warning) => warning.code)

    expect(warningCodes).toContain('binding-value-unknown-state')
    expect(warningCodes).toContain('validation-not-controlled')
    expect(component).not.toContain('const [email, setEmail]')
    expect(component).not.toContain('const [__fieldErrors, __setFieldErrors] = useState')
    expect(component).not.toContain('aria-invalid')
  })

  test('form repair avoids LIST query locals and duplicate declarations', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: { url: 'https://x.supabase.co', anonKey: 'eyJ.anon.sig' }
    })
    const list = graph.createNode('LIST', pageId, {
      name: 'Products',
      width: 300,
      height: 400,
      interactiveProps: {
        dataSourceRef: { kind: 'supabaseQuery', query: { table: 'products' } }
      }
    })
    graph.createNode('TEXT', list.id, {
      name: 'Product row',
      width: 200,
      height: 20,
      text: 'Product'
    })
    const input = graph.createNode('INPUT', pageId, {
      name: 'ProductsRowsInput',
      width: 200,
      height: 40,
      interactiveProps: { validation: { required: true } }
    })
    const plan = planValidatedFormValueBindings(graph, input.id)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.data.bindings[0]?.state.name).toBe('productsRows2')
    graph.updateNode(pageId, { state: plan.data.nextState })
    for (const repair of plan.data.bindings) {
      graph.updateNode(repair.nodeId, { bindings: repair.bindings })
    }

    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain('const [productsRows, setProductsRows] = useState([])')
    expect(app).toContain('const [productsRows2, setProductsRows2] = useState("")')
    expect(app.match(/const \[productsRows, setProductsRows\]/g)).toHaveLength(1)
    expect(app.match(/const \[productsRows2, setProductsRows2\]/g)).toHaveLength(1)
  })
})
