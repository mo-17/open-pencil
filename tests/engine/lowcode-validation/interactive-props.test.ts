import { describe, expect, test } from 'bun:test'

import { validateInteractiveProps } from '@open-pencil/core/lowcode-validation'

const INVALID_KNOWN_FIELDS = [
  ['BUTTON', 'text', 42, 'a string'],
  ['BUTTON', 'textColor', 'black', 'a #RRGGBB color'],
  ['INPUT', 'placeholder', false, 'a string'],
  ['INPUT', 'value', 42, 'a string'],
  ['INPUT', 'textColor', 'white', 'a #RRGGBB color'],
  ['INPUT', 'placeholderColor', '#12345G', 'a #RRGGBB color'],
  ['TEXTAREA', 'placeholder', [], 'a string'],
  ['TEXTAREA', 'value', {}, 'a string'],
  ['TEXTAREA', 'textColor', '#FFF', 'a #RRGGBB color'],
  ['SELECT', 'options', ['Valid', 7], 'an array of strings'],
  ['SELECT', 'value', true, 'a string'],
  ['RADIO', 'options', 'Free,Pro', 'an array of strings'],
  ['RADIO', 'value', 1, 'a string'],
  ['RADIO', 'groupName', false, 'a string'],
  ['CHECKBOX', 'options', [true], 'an array of strings'],
  ['CHECKBOX', 'checked', 'yes', 'a boolean'],
  ['SWITCH', 'checked', 1, 'a boolean'],
  ['DATEPICKER', 'value', 20260727, 'a string'],
  ['DATEPICKER', 'min', false, 'a string'],
  ['DATEPICKER', 'max', [], 'a string']
] as const

describe('validateInteractiveProps', () => {
  test('preserves extensible JSON namespaces while validating owned schemas', () => {
    expect(
      validateInteractiveProps('BUTTON', {
        text: 'Save',
        uiKit: { primitive: 'button' },
        futureNamespace: { enabled: true }
      })
    ).toEqual([])
  })

  test('rejects non-JSON values and malformed field validation', () => {
    expect(
      validateInteractiveProps('INPUT', { onResolve: () => 'not serializable' })[0]
    ).toMatchObject({ severity: 'error', code: 'interactive-props-non-json-value' })

    expect(
      validateInteractiveProps('INPUT', {
        validation: { async: { url: '/check', urlExpr: 'validatorUrl' } }
      })[0]
    ).toMatchObject({
      severity: 'error',
      code: 'interactive-validation-async-url-conflict'
    })
  })

  test('rejects malformed dates but keeps range relationships as warnings', () => {
    expect(validateInteractiveProps('DATEPICKER', { value: '2026-02-30' })[0]).toMatchObject({
      severity: 'error',
      code: 'datepicker-invalid-value',
      path: 'interactiveProps.value'
    })

    expect(
      validateInteractiveProps('DATEPICKER', { min: '2026-12-31', max: '2026-01-01' })
    ).toEqual([
      {
        code: 'datepicker-range-inverted',
        path: 'interactiveProps',
        severity: 'warning',
        reason: 'interactiveProps.min must not be after interactiveProps.max'
      }
    ])
  })

  test.each(INVALID_KNOWN_FIELDS)(
    '%s rejects a non-conforming %s field',
    (nodeType, key, value, expected) => {
      expect(validateInteractiveProps(nodeType, { [key]: value })[0]).toMatchObject({
        severity: 'error',
        code: `interactive-props-${key}-type`,
        path: `interactiveProps.${key}`,
        reason: `interactiveProps.${key} must be ${expected}`
      })
    }
  )

  test('accepts known field types alongside unknown extension keys', () => {
    const cases = [
      ['BUTTON', { text: 'Save', textColor: '#F9FAFB' }],
      [
        'INPUT',
        {
          placeholder: 'Email',
          value: '',
          textColor: '#F7F4EE',
          placeholderColor: '#8B8B93'
        }
      ],
      [
        'TEXTAREA',
        { placeholder: 'Bio', value: 'Hello', textColor: '#111827', placeholderColor: '#6B7280' }
      ],
      ['SELECT', { options: ['Admin'], value: 'Admin' }],
      ['RADIO', { options: ['Free'], value: 'Free', groupName: 'plans' }],
      ['CHECKBOX', { options: ['News'], checked: false }],
      ['SWITCH', { checked: true }],
      ['DATEPICKER', { value: '2026-07-27', min: '2026-01-01', max: '2026-12-31' }]
    ] as const

    for (const [nodeType, fields] of cases) {
      expect(
        validateInteractiveProps(nodeType, {
          ...fields,
          futureNamespace: { enabled: true }
        })
      ).toEqual([])
    }
  })
})
