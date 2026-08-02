import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import type { FormControlsAudit } from '@open-pencil/core/lowcode-validation'
import { SceneGraph } from '@open-pencil/scene-graph'

import { getTool } from '#tests/helpers/tools'

type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string }

function setup() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const editor = createEditor({ graph, skipInitialGraphSetup: true })
  const page = graph.getPages()[0]
  const form = graph.createNode('FORM', page.id, { name: 'CheckoutForm' })
  return { graph, figma, editor, page, form }
}

describe('audit_form_controls / ensure_form_value_bindings', () => {
  test('audits FORM scope with stable names, collision suffixes, and control value types', () => {
    const { graph, figma, page, form } = setup()
    graph.updateNode(page.id, {
      state: [{ id: 'existing', name: 'warningEmail', type: 'string', defaultValue: 'old' }]
    })
    const email = graph.createNode('INPUT', form.id, {
      name: 'warning_email_input',
      interactiveProps: { value: 'seed@example.com', validation: { required: true } }
    })
    const consent = graph.createNode('CHECKBOX', form.id, {
      name: 'WarningConsentCheckbox',
      interactiveProps: { checked: true, validation: { required: true } }
    })
    const tags = graph.createNode('CHECKBOX', form.id, {
      name: 'TagsCheckbox',
      interactiveProps: {
        optionsSource: { kind: 'ref', stateId: 'available-tags' },
        validation: { required: true }
      }
    })

    const result = getTool('audit_form_controls').execute(figma, {
      scope_id: form.id
    }) as ToolResult<{
      summary: { validated: number; missing: number }
      controls: Array<{
        id: string
        stateType: string
        suggestedState: { id: string; name: string; defaultValue: unknown }
      }>
    }>

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.summary).toMatchObject({ validated: 3, missing: 3 })
    const byId = new Map(result.data.controls.map((control) => [control.id, control]))
    expect(byId.get(email.id)?.suggestedState).toMatchObject({
      name: 'warningEmail2',
      defaultValue: 'seed@example.com'
    })
    expect(byId.get(consent.id)).toMatchObject({
      stateType: 'boolean',
      suggestedState: { name: 'warningConsent', defaultValue: true }
    })
    expect(byId.get(tags.id)).toMatchObject({
      stateType: 'array',
      suggestedState: { name: 'tags', defaultValue: [] }
    })
    expect(byId.get(email.id)?.suggestedState.id).toBe(`form-state-${email.id.replace(':', '-')}`)
  })

  test('accepts compiler-compatible number bindings on INPUT while suggesting string state', () => {
    const { graph, figma, page, form } = setup()
    graph.updateNode(page.id, {
      state: [{ id: 'amount', name: 'amount', type: 'number', defaultValue: 0 }]
    })
    const input = graph.createNode('INPUT', form.id, {
      name: 'AmountInput',
      bindings: { value: { kind: 'ref', stateId: 'amount' } },
      interactiveProps: { validation: { required: true } }
    })

    const result = getTool('audit_form_controls').execute(figma, {
      scope_id: input.id
    }) as ToolResult<{
      summary: { valid: number; invalid: number }
      controls: Array<{
        stateType: string
        allowedBindingTypes: string[]
        bindingStatus: string
      }>
    }>

    expect(result).toMatchObject({
      ok: true,
      data: {
        summary: { valid: 1, invalid: 0 },
        controls: [
          {
            stateType: 'string',
            allowedBindingTypes: ['string', 'number'],
            bindingStatus: 'valid'
          }
        ]
      }
    })
  })

  test('allocates compiler-safe names across keywords, runtime locals, and state setters', () => {
    const { graph, figma, page, form } = setup()
    graph.updateNode(page.id, {
      state: [{ id: 'setter', name: 'setEmail', type: 'string', defaultValue: '' }]
    })
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'doc-setter', name: 'setTags', type: 'array', defaultValue: [] }]
    })
    const email = graph.createNode('INPUT', form.id, {
      name: 'EmailInput',
      interactiveProps: { validation: { required: true } }
    })
    const keyword = graph.createNode('INPUT', form.id, {
      name: 'ClassInput',
      interactiveProps: { validation: { required: true } }
    })
    const runtime = graph.createNode('INPUT', form.id, {
      name: 'NavigateInput',
      interactiveProps: { validation: { required: true } }
    })
    const docSetter = graph.createNode('CHECKBOX', form.id, {
      name: 'TagsCheckbox',
      interactiveProps: { options: ['A'], validation: { required: true } }
    })

    const result = getTool('audit_form_controls').execute(figma, {
      scope_id: form.id
    }) as ToolResult<{
      controls: Array<{ id: string; suggestedState: { name: string } }>
    }>

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const names = new Map(
      result.data.controls.map((control) => [control.id, control.suggestedState.name])
    )
    expect(names.get(email.id)).toBe('email2')
    expect(names.get(keyword.id)).toBe('class2')
    expect(names.get(runtime.id)).toBe('navigate2')
    expect(names.get(docSetter.id)).toBe('tags2')
  })

  test('defaults to current page and ignores controls without validation', () => {
    const { graph, figma, page, form } = setup()
    graph.createNode('INPUT', form.id, { name: 'PlainInput' })
    const validated = graph.createNode('SELECT', form.id, {
      name: 'TicketSessionSelect',
      interactiveProps: { validation: { required: true } }
    })

    const result = getTool('audit_form_controls').execute(figma, {}) as ToolResult<{
      pageId: string
      controls: Array<{ id: string; suggestedState: { name: string } }>
    }>

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.pageId).toBe(page.id)
    expect(result.data.controls).toEqual([
      expect.objectContaining({
        id: validated.id,
        suggestedState: expect.objectContaining({ name: 'ticketSession' })
      })
    ])
  })

  test('page and form sweeps skip reusable component-master subtrees', () => {
    const { graph, figma, page, form } = setup()
    const direct = graph.createNode('INPUT', form.id, {
      name: 'DirectInput',
      interactiveProps: { validation: { required: true } }
    })
    const master = graph.createNode('COMPONENT', form.id, { name: 'FieldMaster' })
    graph.createNode('INPUT', master.id, {
      name: 'MasterInput',
      interactiveProps: { validation: { required: true } }
    })
    const set = graph.createNode('COMPONENT_SET', page.id, { name: 'FieldVariants' })
    const variant = graph.createNode('COMPONENT', set.id, { name: 'FieldVariant' })
    graph.createNode('INPUT', variant.id, {
      name: 'VariantInput',
      interactiveProps: { validation: { required: true } }
    })

    const pageResult = getTool('audit_form_controls').execute(figma, {
      scope_id: page.id
    }) as ToolResult<{ total: number; controls: Array<{ id: string }> }>
    const formResult = getTool('audit_form_controls').execute(figma, {
      scope_id: form.id
    }) as ToolResult<{ total: number; controls: Array<{ id: string }> }>

    expect(pageResult).toMatchObject({
      ok: true,
      data: { total: 1, controls: [{ id: direct.id }] }
    })
    expect(formResult).toMatchObject({
      ok: true,
      data: { total: 1, controls: [{ id: direct.id }] }
    })
  })

  test('rejects a control scope inside a reusable component master without mutation', () => {
    const { graph, figma, page } = setup()
    const master = graph.createNode('COMPONENT', page.id, { name: 'FieldMaster' })
    const input = graph.createNode('INPUT', master.id, {
      name: 'EmailInput',
      interactiveProps: { validation: { required: true } }
    })

    const audit = getTool('audit_form_controls').execute(figma, {
      scope_id: input.id
    }) as ToolResult<unknown>
    const repair = getTool('ensure_form_value_bindings').execute(figma, {
      scope_id: input.id,
      dry_run: true
    }) as ToolResult<unknown>

    expect(audit).toMatchObject({ ok: false })
    expect(repair).toMatchObject({ ok: false })
    if (!audit.ok) {
      expect(audit.error).toContain('reusable component master')
      expect(audit.error).toContain('document state')
    }
    expect(graph.getNode(page.id)?.state).toBeUndefined()
    expect(graph.getNode(input.id)?.bindings).toBeUndefined()
  })

  test('reserves compiler LIST query rows and setter locals when naming page state', () => {
    const { graph, figma, page, form } = setup()
    graph.createNode('LIST', page.id, {
      name: 'Products',
      interactiveProps: {
        dataSourceRef: { kind: 'supabaseQuery', query: { table: 'products' } }
      }
    })
    const input = graph.createNode('INPUT', form.id, {
      name: 'ProductsRowsInput',
      interactiveProps: { validation: { required: true } }
    })

    const result = getTool('audit_form_controls').execute(figma, {
      scope_id: input.id
    }) as ToolResult<{ controls: Array<{ suggestedState: { name: string } }> }>

    expect(result).toMatchObject({
      ok: true,
      data: { controls: [{ suggestedState: { name: 'productsRows2' } }] }
    })
  })

  test('bounds audit output and reports total, returned, and truncation', () => {
    const { graph, figma, form } = setup()
    for (let index = 0; index < 205; index++) {
      graph.createNode('INPUT', form.id, {
        name: `Field${index}Input`,
        interactiveProps: { validation: { required: true } }
      })
    }

    const defaultResult = getTool('audit_form_controls').execute(figma, {
      scope_id: form.id
    }) as ToolResult<FormControlsAudit>
    const smallResult = getTool('audit_form_controls').execute(figma, {
      scope_id: form.id,
      limit: 7
    }) as typeof defaultResult
    const clampedResult = getTool('audit_form_controls').execute(figma, {
      scope_id: form.id,
      limit: 999
    }) as typeof defaultResult

    expect(defaultResult).toMatchObject({
      ok: true,
      data: {
        total: 205,
        returned: 50,
        truncated: true,
        summary: { validated: 205, missing: 205 }
      }
    })
    expect(smallResult).toMatchObject({
      ok: true,
      data: { total: 205, returned: 7, truncated: true }
    })
    expect(clampedResult).toMatchObject({
      ok: true,
      data: { total: 205, returned: 200, truncated: true }
    })
    if (defaultResult.ok) expect(defaultResult.data.controls).toHaveLength(50)
    if (smallResult.ok) expect(smallResult.data.controls).toHaveLength(7)
    if (clampedResult.ok) expect(clampedResult.data.controls).toHaveLength(200)
  })

  test('fails a repair before building or mutating more than 199 missing bindings', () => {
    const { graph, figma, page, form } = setup()
    const inputs = Array.from({ length: 200 }, (_, index) =>
      graph.createNode('INPUT', form.id, {
        name: `Field${index}Input`,
        interactiveProps: { validation: { required: true } }
      })
    )

    const result = getTool('ensure_form_value_bindings').execute(figma, {
      scope_id: form.id,
      dry_run: true
    }) as ToolResult<unknown>

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.error).toContain('more than 199')
      expect(result.error).toContain('narrow scope')
    }
    expect(graph.getNode(page.id)?.state).toBeUndefined()
    expect(inputs.every((input) => graph.getNode(input.id)?.bindings === undefined)).toBe(true)
  })

  test('allows an exact 199-repair dry run while keeping its audit bounded', () => {
    const { graph, figma, page, form } = setup()
    for (let index = 0; index < 199; index++) {
      graph.createNode('INPUT', form.id, {
        name: `Field${index}Input`,
        interactiveProps: { validation: { required: true } }
      })
    }

    const result = getTool('ensure_form_value_bindings').execute(figma, {
      scope_id: form.id,
      dry_run: true
    }) as ToolResult<{
      createdStates: number
      audit: FormControlsAudit
      boundNodeIds: string[]
    }>

    expect(result).toMatchObject({
      ok: true,
      data: {
        createdStates: 199,
        audit: { total: 199, returned: 50, truncated: true }
      }
    })
    if (result.ok) expect(result.data.boundNodeIds).toHaveLength(199)
    expect(graph.getNode(page.id)?.state).toBeUndefined()
  })

  test('dry_run returns the repair plan without mutating', () => {
    const { graph, figma, page, form } = setup()
    const input = graph.createNode('INPUT', form.id, {
      name: 'EmailInput',
      interactiveProps: { validation: { required: true } }
    })
    const result = getTool('ensure_form_value_bindings').execute(figma, {
      scope_id: form.id,
      dry_run: true
    }) as ToolResult<{ dryRun: boolean; createdStates: number; boundNodeIds: string[] }>

    expect(result).toMatchObject({
      ok: true,
      data: { dryRun: true, createdStates: 1, boundNodeIds: [input.id] }
    })
    expect(graph.getNode(page.id)?.state).toBeUndefined()
    expect(graph.getNode(input.id)?.bindings).toBeUndefined()
  })

  test('creates page state and bindings in one undo batch while preserving other channels', () => {
    const { graph, figma, editor, page, form } = setup()
    graph.updateNode(page.id, {
      state: [{ id: 'keep', name: 'keep', type: 'number', defaultValue: 1 }]
    })
    const input = graph.createNode('INPUT', form.id, {
      name: 'VisitorNameInput',
      bindings: { text: { kind: 'literal', literalValue: 'keep me' } },
      interactiveProps: { validation: { required: true } }
    })
    const checkbox = graph.createNode('CHECKBOX', form.id, {
      name: 'TermsCheckbox',
      interactiveProps: { validation: { required: true } }
    })

    const result = getTool('ensure_form_value_bindings').execute(
      figma,
      { scope_id: form.id },
      { editor }
    ) as ToolResult<{ createdStates: number; boundNodeIds: string[] }>

    expect(result).toMatchObject({ ok: true, data: { createdStates: 2 } })
    expect(graph.getNode(page.id)?.state).toEqual([
      { id: 'keep', name: 'keep', type: 'number', defaultValue: 1 },
      expect.objectContaining({ name: 'visitorName', type: 'string', defaultValue: '' }),
      expect.objectContaining({ name: 'terms', type: 'boolean', defaultValue: false })
    ])
    expect(graph.getNode(input.id)?.bindings).toMatchObject({
      text: { kind: 'literal', literalValue: 'keep me' },
      value: { kind: 'ref' }
    })
    expect(graph.getNode(checkbox.id)?.bindings?.value).toMatchObject({ kind: 'ref' })
    expect(editor.undo.undoLabel).toBe('AI: ensure_form_value_bindings')

    const repeated = getTool('ensure_form_value_bindings').execute(
      figma,
      { scope_id: form.id },
      { editor }
    ) as ToolResult<{ createdStates: number }>
    expect(repeated).toMatchObject({ ok: true, data: { createdStates: 0 } })

    expect(editor.undo.undo()).toBe('AI: ensure_form_value_bindings')
    expect(graph.getNode(page.id)?.state).toEqual([
      { id: 'keep', name: 'keep', type: 'number', defaultValue: 1 }
    ])
    expect(graph.getNode(input.id)?.bindings).toEqual({
      text: { kind: 'literal', literalValue: 'keep me' }
    })
    expect(graph.getNode(checkbox.id)?.bindings).toBeUndefined()
    expect(editor.undo.canUndo).toBe(false)
  })

  test('preserves invalid authored bindings and reports them instead of overwriting', () => {
    const { graph, figma, page, form } = setup()
    const input = graph.createNode('INPUT', form.id, {
      name: 'EmailInput',
      bindings: { value: { kind: 'ref', stateId: 'missing-state' } },
      interactiveProps: { validation: { required: true } }
    })

    const result = getTool('ensure_form_value_bindings').execute(figma, {
      scope_id: input.id
    }) as ToolResult<{
      createdStates: number
      audit: { summary: { invalid: number }; controls: Array<{ reason?: string }> }
    }>

    expect(result).toMatchObject({
      ok: true,
      data: { createdStates: 0, audit: { summary: { invalid: 1 } } }
    })
    if (!result.ok) return
    expect(result.data.audit.controls[0].reason).toContain('does not exist')
    expect(graph.getNode(input.id)?.bindings?.value).toEqual({
      kind: 'ref',
      stateId: 'missing-state'
    })
    expect(graph.getNode(page.id)?.state).toBeUndefined()
  })

  test('rejects stale expected_scene_version before mutation', () => {
    const { graph, figma, editor, page, form } = setup()
    const input = graph.createNode('INPUT', form.id, {
      name: 'EmailInput',
      interactiveProps: { validation: { required: true } }
    })

    const result = getTool('ensure_form_value_bindings').execute(
      figma,
      { scope_id: form.id, expected_scene_version: editor.state.sceneVersion + 1 },
      { editor }
    ) as ToolResult<unknown>

    expect(result.ok).toBe(false)
    expect(graph.getNode(page.id)?.state).toBeUndefined()
    expect(graph.getNode(input.id)?.bindings).toBeUndefined()
    expect(editor.undo.canUndo).toBe(false)
  })
})
