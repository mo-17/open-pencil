import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §19 — a controlled form field carrying `interactiveProps.validation`
 * emits client-side validation: a `validateValue` import + a page-level errors
 * store + a `__validators` map, per-field `aria-invalid` + validate-on-blur, a
 * per-field error `<p>` below the input, and (on the enclosing `<form>`) an
 * onSubmit that validates every field and aborts when any is invalid.
 *
 * Locked forks: timing = onSubmit (block) + onBlur (live); error display =
 * per-field below; rules = core (required/pattern/length/range) + customExpr.
 */
describe('compile — form validation (Phase 4 §19)', () => {
  const EMAIL_DOC = [{ id: 'd1', name: 'email', type: 'string', defaultValue: '' }]

  /** Build a single page with one controlled INPUT bound to `email` carrying
   *  the given validation config, optionally inside a <form>. */
  function compileField(
    validation: Record<string, unknown>,
    opts: { inForm?: boolean; extraInputProps?: Record<string, unknown> } = {}
  ): { app: string; warnings: { code: string }[]; files: Map<string, string | Uint8Array> } {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, { lowcodeDocumentState: EMAIL_DOC })
    const parent = opts.inForm
      ? graph.createNode('FORM', pageId, { name: 'F', width: 300, height: 200 }).id
      : pageId
    graph.createNode('INPUT', parent, {
      name: 'Email',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      interactiveProps: { ...opts.extraInputProps, validation }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    return { app: out.files.get('src/App.tsx') as string, warnings: out.warnings, files: out.files }
  }

  test('core rules → validateValue import, errors store, validators map, field attrs, error <p>, runtime file', () => {
    const { app, files } = compileField({
      required: true,
      pattern: '^[^@]+@[^@]+$',
      minLength: 5,
      messages: { required: 'Email required' }
    })
    // imports + page-level glue
    expect(app).toContain("import { validateValue } from './_lowcode_validation'")
    expect(app).toContain('getDocStateSnapshot')
    expect(app).toContain('const [__fieldErrors, __setFieldErrors] = useState')
    expect(app).toContain(
      'const __validators: Record<string, (valueOverride?: unknown, includeAsync?: boolean) => Promise<string | null>> = {'
    )
    expect(app).toContain(
      'const __value = __valueOverride !== undefined ? __valueOverride : getDocStateSnapshot("email")'
    )
    expect(app).toContain('let __error = validateValue(__value, {"required":true')
    expect(app).toContain('"minLength":5')
    expect(app).toContain('"messages":{"required":"Email required"}')
    expect(app).toContain('const __validateField = async (id: string): Promise<string | null> =>')
    expect(app).toContain(
      'const __validateFieldValue = async (id: string, value: unknown, includeAsync = false): Promise<string | null> =>'
    )
    expect(app).toContain('const __validateFields = async (ids: string[]): Promise<boolean> =>')
    // field attrs + per-field error <p>
    expect(app).toContain('aria-invalid={__fieldErrors[')
    expect(app).toContain('setDocState("email", e.target.value); await __validateFieldValue(')
    expect(app).toContain('onBlur={async (e) => { await __validateFieldValue(')
    expect(app).toContain('<p className="text-sm text-red-600 mt-1" role="alert">{__fieldErrors[')
    // runtime file
    expect(files.has('src/_lowcode_validation.tsx')).toBe(true)
    expect(files.get('src/_lowcode_validation.tsx') as string).toContain(
      'export function validateValue'
    )
  })

  test('customExpr → inline truthiness check with custom message', () => {
    const { app } = compileField({
      customExpr: 'email !== "blocked@x.com"',
      messages: { custom: 'That email is blocked' }
    })
    expect(app).toContain(
      'if (__error === null && !(email !== "blocked@x.com")) __error = "That email is blocked"'
    )
  })

  test('customExpr with no message falls back to a default', () => {
    const { app } = compileField({ customExpr: 'email !== ""' })
    expect(app).toContain('__error = "Invalid value"')
  })

  test('FORM onSubmit is wrapped: preventDefault + validate + abort, then user actions', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'email', type: 'string', defaultValue: '' },
        { id: 'd2', name: 'status', type: 'string', defaultValue: '' }
      ]
    })
    const form = graph.createNode('FORM', pageId, {
      name: 'F',
      width: 300,
      height: 200,
      events: {
        onSubmit: [{ id: 's', kind: 'setVariable', targetName: 'status', valueExpr: '"done"' }]
      }
    })
    graph.createNode('INPUT', form.id, {
      name: 'Email',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      interactiveProps: { validation: { required: true } }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app = out.files.get('src/App.tsx') as string
    const form2 = app.split('\n').find((l) => l.includes('onSubmit=')) ?? ''
    expect(form2).toContain(
      'onSubmit={async (e) => { e.preventDefault(); if (!(await __validateFields(['
    )
    expect(form2).toContain(']))) return; setDocState("status", "done"); }}')
  })

  test('FORM with no user onSubmit still emits a validate-only onSubmit', () => {
    const { app } = compileField({ required: true }, { inForm: true })
    const formLine = app.split('\n').find((l) => l.includes('<form')) ?? ''
    expect(formLine).toContain(
      'onSubmit={async (e) => { e.preventDefault(); if (!(await __validateFields(['
    )
    expect(formLine).toContain(']))')
    // the form's validate keys include the field
    expect(formLine).toMatch(/__validateFields\(\["[^"]+"\]\)/)
  })

  test('async custom validator emits validateRemote after sync rules pass', () => {
    const { app, files } = compileField({
      required: true,
      async: {
        url: '/api/check-email',
        method: 'POST',
        message: 'Email is already taken'
      }
    })
    expect(app).toContain("import { validateRemote, validateValue } from './_lowcode_validation'")
    expect(app).toContain(
      'if (__includeAsync && __error === null) __error = await validateRemote(__value, { url: "/api/check-email", method: "POST", message: "Email is already taken" })'
    )
    const runtime = files.get('src/_lowcode_validation.tsx') as string
    expect(runtime).toContain('export async function validateRemote')
    expect(runtime).toContain('body: JSON.stringify({ value })')
  })

  test('async custom validator can use a bound URL expression and GET method', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'email', type: 'string', defaultValue: '' },
        { id: 'd2', name: 'validatorUrl', type: 'string', defaultValue: '/api/check-email' }
      ]
    })
    graph.createNode('INPUT', pageId, {
      name: 'Email',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      interactiveProps: {
        validation: {
          async: {
            urlExpr: 'validatorUrl',
            method: 'GET',
            message: 'Remote validation failed'
          }
        }
      }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('const validatorUrl = useDocState("validatorUrl")')
    expect(app).toContain(
      'await validateRemote(__value, { url: validatorUrl, method: "GET", message: "Remote validation failed" })'
    )
    expect(out.warnings).toEqual([])
  })

  test('FORM validation summary is opt-in and aggregates field errors', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, { lowcodeDocumentState: EMAIL_DOC })
    const form = graph.createNode('FORM', pageId, {
      name: 'F',
      width: 300,
      height: 200,
      interactiveProps: { validationSummary: { enabled: true, title: 'Fix these fields' } }
    })
    const input = graph.createNode('INPUT', form.id, {
      name: 'Email',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      interactiveProps: { validation: { required: true } }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app = out.files.get('src/App.tsx') as string
    const k = JSON.stringify(input.id)
    expect(app).toContain(`${k}].some((id) => __fieldErrors[id])`)
    expect(app).toContain('<div className="text-sm text-red-600 mt-1" role="alert">')
    expect(app).toContain('<p>Fix these fields</p>')
    expect(app).toContain(`<li key={id}>{__fieldErrors[id]}</li>`)
  })

  test('FORM validation summary is disabled by default for byte stability', () => {
    const { app } = compileField({ required: true }, { inForm: true })
    expect(app).not.toContain('Please fix the highlighted fields.')
    expect(app).not.toContain('.some((id) => __fieldErrors[id])')
  })

  test('a validation config on an uncontrolled input → warn + plain input (no validation)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, { lowcodeDocumentState: EMAIL_DOC })
    // no bindings.value → uncontrolled
    graph.createNode('INPUT', pageId, {
      name: 'Email',
      width: 200,
      height: 40,
      interactiveProps: { validation: { required: true } }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(out.warnings.map((w) => w.code)).toContain('validation-not-controlled')
    expect(app).not.toContain('aria-invalid')
    expect(app).not.toContain('__validators')
    expect(out.files.has('src/_lowcode_validation.tsx')).toBe(false)
  })

  test('no validation → byte-identical (no runtime import / store / runtime file / error class)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, { lowcodeDocumentState: EMAIL_DOC })
    graph.createNode('INPUT', pageId, {
      name: 'Email',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('_lowcode_validation')
    expect(app).not.toContain('__validators')
    expect(app).not.toContain('aria-invalid')
    expect(out.files.has('src/_lowcode_validation.tsx')).toBe(false)
    expect(out.files.get('src/index.css') as string).not.toContain('text-red-600')
  })

  test('multiple validated fields in a form → one validator entry each + both in the form keys', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'email', type: 'string', defaultValue: '' },
        { id: 'd2', name: 'pw', type: 'string', defaultValue: '' }
      ]
    })
    const form = graph.createNode('FORM', pageId, { name: 'F', width: 300, height: 300 })
    const a = graph.createNode('INPUT', form.id, {
      name: 'Email',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      interactiveProps: { validation: { required: true } }
    })
    const b = graph.createNode('INPUT', form.id, {
      name: 'Password',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'pw' } },
      interactiveProps: { validation: { minLength: 8 } }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(
      `${JSON.stringify(a.id)}: async (__valueOverride?: unknown, __includeAsync = true) => {`
    )
    expect(app).toContain(
      `${JSON.stringify(b.id)}: async (__valueOverride?: unknown, __includeAsync = true) => {`
    )
    const formLine = app.split('\n').find((l) => l.includes('<form')) ?? ''
    expect(formLine).toContain(JSON.stringify(a.id))
    expect(formLine).toContain(JSON.stringify(b.id))
  })

  test('invalid pattern → warn + pattern dropped from rules', () => {
    const { app, warnings } = compileField({ required: true, pattern: '([unbalanced' })
    expect(warnings.map((w) => w.code)).toContain('validation-invalid-pattern')
    expect(app).not.toContain('([unbalanced')
    expect(app).toContain('"required":true')
  })

  test('non-finite numeric rule → warn + dropped', () => {
    const { app, warnings } = compileField({ minLength: Number.NaN, required: true })
    expect(warnings.map((w) => w.code)).toContain('validation-invalid-number')
    expect(app).not.toContain('minLength')
  })

  test('page-state-bound field reads its local (no getDocStateSnapshot)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(pageId, {
      state: [{ id: 's1', name: 'name', type: 'string', defaultValue: '' }]
    })
    graph.createNode('INPUT', pageId, {
      name: 'Name',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'ref', stateId: 's1' } },
      interactiveProps: { validation: { required: true } }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('const __value = __valueOverride !== undefined ? __valueOverride : name')
    expect(app).toContain('setName(e.target.value); await __validateFieldValue(')
    expect(app).not.toContain('getDocStateSnapshot')
  })

  test('a validated controlled onChange writes, validates next value, then runs user actions', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'email', type: 'string', defaultValue: '' },
        { id: 'd2', name: 'status', type: 'string', defaultValue: '' }
      ]
    })
    const input = graph.createNode('INPUT', pageId, {
      name: 'Email',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      events: {
        onChange: [{ id: 'c', kind: 'setVariable', targetName: 'status', valueExpr: '$value' }]
      },
      interactiveProps: { validation: { required: true } }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app = out.files.get('src/App.tsx') as string
    const k = JSON.stringify(input.id)
    expect(app).toContain(
      `setDocState("email", e.target.value); await __validateFieldValue(${k}, e.target.value); setDocState("status", $value);`
    )
    expect(app).toContain(
      'onChange={async (e) => { const $event = e; const $value = (e.target as HTMLInputElement).value;'
    )
  })

  test('a user-defined onBlur on a validated field runs after validation', () => {
    const { app, warnings } = compileField(
      { required: true },
      {
        extraInputProps: {}
      }
    )
    // baseline: no user onBlur → just the validation onBlur
    expect(app).toContain('onBlur={async (e) => { await __validateFieldValue(')

    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'email', type: 'string', defaultValue: '' },
        { id: 'd2', name: 'touched', type: 'string', defaultValue: '' }
      ]
    })
    graph.createNode('INPUT', pageId, {
      name: 'Email',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      events: {
        onBlur: [{ id: 'b', kind: 'setVariable', targetName: 'touched', valueExpr: '"yes"' }]
      },
      interactiveProps: { validation: { required: true } }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'v' }) })
    const app2 = out.files.get('src/App.tsx') as string
    expect(out.warnings.map((w) => w.code)).not.toContain('validation-onblur-conflict')
    expect(app2).toContain(
      'onBlur={async (e) => { const $event = e; const $value = (e.target as HTMLInputElement).value; await __validateFieldValue('
    )
    expect(app2).toContain('setDocState("touched", "yes")')
    void warnings
  })

  test('validation-error classes are seeded into the Tailwind safelist (index.css)', () => {
    const { files } = compileField({ required: true })
    const css = files.get('src/index.css') as string
    expect(css).toContain('text-red-600')
  })
})
