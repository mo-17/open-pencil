import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, initCodec } from '@open-pencil/core'

/**
 * Phase 3 §15 Phase B — shadcn Radix-composition controls. With `uiKit: 'shadcn'`
 * the four named form controls become composed kit components with shadcn's
 * distinct event API (`onCheckedChange` / `onValueChange`), not the plain-HTML
 * `onChange`:
 *  - SELECT  → `<Select value onValueChange>` + SelectTrigger/SelectValue/Content + SelectItem per option
 *  - CHECKBOX (single boolean) → `<Checkbox checked onCheckedChange>`
 *  - SWITCH  → `<Switch checked onCheckedChange>`
 *  - RADIO   → `<RadioGroup value onValueChange>` + RadioGroupItem + label per option
 * Phase 4 §15 Phase C — the array multi-select CHECKBOX group becomes N
 * `<Checkbox>` rows + manual array toggle (shadcn has no native group component).
 * Phase 4 §17.4 covers dynamic data-bound option lists separately.
 */
function compileShadcn(graph: SceneGraph, pageId: string, pkg: string, i18n = false) {
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: pkg, uiKit: 'shadcn', i18n })
  })
}

describe('compile — shadcn Radix controls (Phase 3 §15 Phase B)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('CHECKBOX (single boolean) → <Checkbox checked onCheckedChange> + import + dep', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false }]
    })
    graph.createNode('CHECKBOX', page.id, {
      bindings: { value: { kind: 'docState', docStateName: 'agreed' } }
    })

    const out = compileShadcn(graph, page.id, 'kb-checkbox')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(`import { Checkbox } from '@/components/ui/checkbox'`)
    expect(app).toContain('<Checkbox')
    expect(app).toContain('checked={agreed}')
    // shadcn event API — boolean | 'indeterminate' coerced to a strict bool.
    expect(app).toContain('onCheckedChange={(checked) => setDocState("agreed", checked === true)}')
    // NOT the plain-HTML dispatch.
    expect(app).not.toContain('<input')
    expect(app).not.toContain('onChange={(e)')

    expect(out.files.has('src/components/ui/checkbox.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-checkbox')
    expect(out.warnings).toEqual([])
  })

  test('SWITCH → <Switch checked onCheckedChange>, no role="switch", no plain onChange', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'dark', type: 'boolean', defaultValue: false }]
    })
    graph.createNode('SWITCH', page.id, {
      bindings: { value: { kind: 'docState', docStateName: 'dark' } }
    })

    const out = compileShadcn(graph, page.id, 'kb-switch')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(`import { Switch } from '@/components/ui/switch'`)
    expect(app).toContain('<Switch')
    expect(app).toContain('checked={dark}')
    expect(app).toContain('onCheckedChange={(checked) => setDocState("dark", checked)}')
    expect(app).not.toContain('role="switch"')
    expect(app).not.toContain('onChange={(e)')
    expect(out.files.has('src/components/ui/switch.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-switch')
    expect(out.warnings).toEqual([])
  })

  test('SELECT → <Select value onValueChange> + SelectItem per option + 5-export import + dep', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'country', type: 'string', defaultValue: '' }]
    })
    graph.createNode('SELECT', page.id, {
      interactiveProps: { options: ['US', 'CN', 'JP'] },
      bindings: { value: { kind: 'docState', docStateName: 'country' } }
    })

    const out = compileShadcn(graph, page.id, 'kb-select')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(
      `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'`
    )
    expect(app).toContain(
      '<Select value={country} onValueChange={(value) => setDocState("country", value)}>'
    )
    expect(app).toContain('<SelectTrigger')
    expect(app).toContain('<SelectValue />')
    expect(app).toContain('<SelectContent>')
    expect(app).toContain('<SelectItem value="US">US</SelectItem>')
    expect(app).toContain('<SelectItem value="JP">JP</SelectItem>')
    // plain <select>/<option> gone.
    expect(app).not.toContain('<select')
    expect(app).not.toContain('<option')
    expect(out.files.has('src/components/ui/select.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-select')
    expect(out.warnings).toEqual([])
  })

  test('RADIO → <RadioGroup value onValueChange> + RadioGroupItem + <label htmlFor> per option', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's1', name: 'gender', type: 'string', defaultValue: '' }]
    })
    graph.createNode('RADIO', page.id, {
      interactiveProps: { options: ['M', 'F'], groupName: 'g' },
      bindings: { value: { kind: 'ref', stateId: 's1' } }
    })

    const out = compileShadcn(graph, page.id, 'kb-radio')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(
      `import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'`
    )
    expect(app).toContain('<RadioGroup')
    expect(app).toContain('value={gender}')
    expect(app).toContain('onValueChange={(value) => setGender(value)}')
    expect(app).toMatch(/<RadioGroupItem value="M" id="[^"]+" \/>/)
    expect(app).toMatch(/<label htmlFor="[^"]+">M<\/label>/)
    // plain radio leaves + per-option checked gone.
    expect(app).not.toContain('<input type="radio"')
    expect(app).not.toContain('checked={gender === "M"}')
    expect(app).not.toContain('defaultChecked')
    expect(out.files.has('src/components/ui/radio-group.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-radio-group')
    expect(out.warnings).toEqual([])
  })

  test('uncontrolled CHECKBOX (checked) → <Checkbox defaultChecked> (no onCheckedChange)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('CHECKBOX', page.id, { interactiveProps: { checked: true } })

    const out = compileShadcn(graph, page.id, 'kb-checkbox-uncontrolled')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<Checkbox')
    expect(app).toContain('defaultChecked')
    expect(app).not.toContain('onCheckedChange')
    expect(app).not.toContain('checked={')
  })

  test('uncontrolled RADIO (interactiveProps.value) → <RadioGroup defaultValue="F">', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RADIO', page.id, {
      interactiveProps: { options: ['M', 'F'], value: 'F' }
    })

    const out = compileShadcn(graph, page.id, 'kb-radio-uncontrolled')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<RadioGroup')
    expect(app).toContain('defaultValue="F"')
    expect(app).not.toContain('onValueChange')
  })

  test('array CHECKBOX group (docState array) → N <Checkbox> rows + includes/toggle + import + dep', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'fruits', type: 'array', defaultValue: [] }]
    })
    graph.createNode('CHECKBOX', page.id, {
      interactiveProps: { options: ['Apple', 'Banana'] },
      bindings: { value: { kind: 'docState', docStateName: 'fruits' } }
    })

    const out = compileShadcn(graph, page.id, 'kb-checkbox-group')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(`import { Checkbox } from '@/components/ui/checkbox'`)
    // One <Checkbox> per option, paired with its <label htmlFor> in a flex row.
    expect(app).toMatch(/<Checkbox id="[^"]+" checked={fruits\.includes\("Apple"\)}/)
    expect(app).toMatch(/<label htmlFor="[^"]+">Apple<\/label>/)
    // shadcn event API — onCheckedChange (boolean | 'indeterminate'); array spread/filter toggle.
    expect(app).toContain(
      'onCheckedChange={(checked) => setDocState("fruits", checked === true ? [...fruits, "Apple"] : fruits.filter((v) => v !== "Apple"))}'
    )
    // The wrapper stays a plain <div> (no native group component), no plain <input>.
    expect(app).not.toContain('<input')
    expect(app).not.toContain('onChange={(e)')

    expect(out.files.has('src/components/ui/checkbox.tsx')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-checkbox')
    expect(out.warnings).toEqual([])
  })

  test('array CHECKBOX group (page-state array) uses the useState setter', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's1', name: 'tags', type: 'array', defaultValue: [] }]
    })
    graph.createNode('CHECKBOX', page.id, {
      interactiveProps: { options: ['a', 'b'] },
      bindings: { value: { kind: 'ref', stateId: 's1' } }
    })

    const out = compileShadcn(graph, page.id, 'kb-checkbox-group-state')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(
      'onCheckedChange={(checked) => setTags(checked === true ? [...tags, "a"] : tags.filter((v) => v !== "a"))}'
    )
  })

  test('uncontrolled array CHECKBOX group → bare <Checkbox> rows (no checked, no onCheckedChange)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('CHECKBOX', page.id, {
      interactiveProps: { options: ['Apple', 'Banana'] }
    })

    const out = compileShadcn(graph, page.id, 'kb-checkbox-group-uncontrolled')
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<Checkbox id="[^"]+" \/>/)
    expect(app).toMatch(/<label htmlFor="[^"]+">Apple<\/label>/)
    expect(app).not.toContain('checked={')
    expect(app).not.toContain('onCheckedChange')
    expect(out.files.has('src/components/ui/checkbox.tsx')).toBe(true)
  })

  test('array CHECKBOX group option labels stay i18n-aware (emitChild) → <FormattedMessage>', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('CHECKBOX', page.id, {
      interactiveProps: { options: ['Apple', 'Banana'] }
    })

    const out = compileShadcn(graph, page.id, 'kb-checkbox-group-i18n', true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<label htmlFor="[^"]+"><FormattedMessage id="[^"]+" defaultMessage=/)
  })

  test('no uiKit → array CHECKBOX group stays plain HTML (byte-identical path)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'fruits', type: 'array', defaultValue: [] }]
    })
    graph.createNode('CHECKBOX', page.id, {
      interactiveProps: { options: ['Apple', 'Banana'] },
      bindings: { value: { kind: 'docState', docStateName: 'fruits' } }
    })

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'kb-checkbox-group-off' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('type="checkbox" value="Apple"')
    expect(app).toContain('checked={fruits.includes("Apple")}')
    expect(app).toContain(
      'onChange={(e) => setDocState("fruits", e.target.checked ? [...fruits, "Apple"] : fruits.filter((v) => v !== "Apple"))}'
    )
    expect(app).not.toContain('<Checkbox')
    expect(out.files.has('src/components/ui/checkbox.tsx')).toBe(false)
  })

  test('SELECT option labels stay i18n-aware (emitChild) → SelectItem holds <FormattedMessage>', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('SELECT', page.id, {
      interactiveProps: { options: ['Red', 'Green'] }
    })

    const out = compileShadcn(graph, page.id, 'kb-select-i18n', true)
    const app = out.files.get('src/App.tsx') as string
    // The option label is externalized inside the SelectItem; the value= stays literal.
    expect(app).toMatch(/<SelectItem value="Red"><FormattedMessage id="[^"]+" defaultMessage=/)
    expect(app).not.toContain('<option')
  })

  test('no uiKit → controls stay plain HTML (byte-identical path)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'dark', type: 'boolean', defaultValue: false }]
    })
    graph.createNode('SWITCH', page.id, {
      bindings: { value: { kind: 'docState', docStateName: 'dark' } }
    })

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'kb-off' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('role="switch"')
    expect(app).toContain('onChange={(e) => setDocState("dark", e.target.checked)}')
    expect(app).not.toContain('<Switch')
    expect(app).not.toContain('onCheckedChange')
    expect(out.files.has('src/components/ui/switch.tsx')).toBe(false)
  })
})
