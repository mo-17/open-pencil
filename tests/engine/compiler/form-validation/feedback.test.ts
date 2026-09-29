import { expect, test } from 'bun:test'

import { buildLowcodeValidationRuntime } from '#compiler/adapters/react/lowcode/validation'
import { buildVueValidationRuntime } from '#compiler/adapters/vue/lowcode/validation'
import { compile, withDefaults } from '#compiler/index'

import { SceneGraph } from '@open-pencil/scene-graph'

function validateRuntime(target: 'react' | 'vue') {
  const source = target === 'react' ? buildLowcodeValidationRuntime() : buildVueValidationRuntime()
  const name = target === 'react' ? 'validateValue' : '__opValidateValue'
  const javascript = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(source)
    .replaceAll('export ', '')
  return new Function(`${javascript}\nreturn ${name}`)() as (
    value: unknown,
    rules: Record<string, unknown>
  ) => string | null
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} numeric range validation rejects non-finite values without coercing empty optional fields`, () => {
    const validate = validateRuntime(target)
    for (const value of ['not a number', 'NaN', Number.NaN, Infinity, -Infinity, '1e999']) {
      expect(validate(value, { min: 1 })).not.toBeNull()
      expect(validate(value, { max: 10 })).not.toBeNull()
    }
    expect(validate('', { min: 1 })).toBeNull()
    expect(validate('2', { min: 1, max: 10 })).toBeNull()
    expect(validate(0, { min: 0 })).toBeNull()
    expect(validate('word', {})).toBeNull()
    expect(validate('bad', { min: 1, messages: { min: 'Enter a valid amount' } })).toBe(
      'Enter a valid amount'
    )
  })

  test(`${target} validated controls retain required semantics and a stable focus target`, () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    graph.updateNode(pageId, {
      state: [{ id: 'choice', name: 'choice', type: 'string', defaultValue: '' }]
    })
    const form = graph.createNode('FORM', pageId)
    graph.createNode('RADIO', form.id, {
      interactiveProps: { options: ['One', 'Two'], validation: { required: true } },
      bindings: { value: { kind: 'ref', stateId: 'choice' } }
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target, devMode: false })
    })
    const code = [...out.files]
      .filter(([path]) => path.endsWith(target === 'vue' ? '.vue' : '.tsx'))
      .map(([, source]) => source)
      .join('\n')
    expect(code).toContain('aria-required="true"')
    expect(code).toContain('data-openpencil-validation-field-key')
    expect(code).toContain('__opSubmitForm')
    if (target === 'vue') {
      expect(code).toContain('@focusout=')
      expect(code).toContain('__validateField(')
    } else {
      expect(code).toContain('aria-describedby=')
    }
  })

  test(`${target} option groups validate the next complete value when an option changes`, async () => {
    const { formFeedbackFixture } =
      await import('#tests/helpers/compiler/components/form-validation/fixture')
    const output = formFeedbackFixture(target)
    const code = [...output.files.values()]
      .filter((source): source is string => typeof source === 'string')
      .find((source) => source.includes('const __validators:'))
    expect(code).toBeDefined()
    if (!code) throw new Error('Validated page source missing')
    if (target === 'react') {
      for (const type of ['radio', 'checkbox']) {
        const input = code.split('\n').find((line) => line.includes(`type="${type}"`))
        expect(input).toContain('__validateFieldValue(')
        expect(input).not.toContain('data-openpencil-validation-field-key')
      }
    } else {
      expect(code).toContain('const __opNextValue = "Alpha"')
      expect(code).toMatch(/const __opNextValue = .*\.checked \? \[.*"One"/)
      expect(code).toMatch(/__validateFieldValue\([^\n]+, __opNextValue\)/)
    }
  })
}

for (const scenario of ['react', 'vue', 'react-shadcn'] as const) {
  test(`${scenario} form feedback exported project passes the actual type checker`, async () => {
    const { formFeedbackFixture } =
      await import('#tests/helpers/compiler/components/form-validation/fixture')
    const { typeCheckCompilerFiles } = await import('#tests/helpers/compiler/typecheck')
    const target = scenario === 'vue' ? 'vue' : 'react'
    const output = formFeedbackFixture(target, scenario === 'react-shadcn')
    expect(output.warnings.map((warning) => warning.code)).toEqual(
      scenario === 'react-shadcn' ? ['ui-kit-native-control-fallback'] : []
    )
    const files = new Map<string, string>()
    for (const [path, content] of output.files)
      if (typeof content === 'string') files.set(path, content)
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  }, 35_000)
}
