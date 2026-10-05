import { describe, expect, test } from 'bun:test'

import { validateInteractiveProps } from '@open-pencil/lowcode'

const INVALID_KNOWN_FIELDS = [
  ['BUTTON', 'text', 42, 'a string'],
  ['BUTTON', 'textColor', 'black', 'a #RRGGBB color'],
  ['INPUT', 'placeholder', false, 'a string'],
  ['INPUT', 'value', 42, 'a string'],
  [
    'INPUT',
    'inputType',
    'file',
    'text, email, password, number, tel, url, search, time, datetime-local, color'
  ],
  ['INPUT', 'textColor', 'white', 'a #RRGGBB color'],
  ['INPUT', 'placeholderColor', '#12345G', 'a #RRGGBB color'],
  ['TEXTAREA', 'placeholder', [], 'a string'],
  ['TEXTAREA', 'value', {}, 'a string'],
  ['TEXTAREA', 'textColor', '#FFF', 'a #RRGGBB color'],
  ['SELECT', 'options', ['Valid', 7], 'an array of strings or label/value options'],
  ['SELECT', 'value', true, 'a string'],
  ['SELECT', 'placeholder', true, 'a string'],
  ['SELECT', 'allowClear', 'yes', 'a boolean'],
  ['SELECT', 'showSearch', 'true', 'a boolean'],
  ['SELECT', 'virtual', 1000, 'a boolean'],
  ['SELECT', 'textColor', 'red', 'a #RRGGBB color'],
  ['SELECT', 'placeholderColor', '#123', 'a #RRGGBB color'],
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
          inputType: 'email',
          textColor: '#F7F4EE',
          placeholderColor: '#8B8B93'
        }
      ],
      [
        'TEXTAREA',
        { placeholder: 'Bio', value: 'Hello', textColor: '#111827', placeholderColor: '#6B7280' }
      ],
      [
        'SELECT',
        {
          options: ['Admin'],
          value: 'Admin',
          placeholder: 'Choose role',
          allowClear: true,
          showSearch: true,
          virtual: true,
          textColor: '#111827',
          placeholderColor: '#6B7280'
        }
      ],
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

  test.each([
    {},
    { showSearch: false, virtual: false },
    { showSearch: true, virtual: false },
    { showSearch: false, virtual: true },
    { showSearch: true, virtual: true }
  ])('SELECT search and virtualization remain independent opt-in JSON properties: %j', (modes) => {
    const props = {
      options: [{ label: '团队', value: 'team' }],
      value: 'team',
      ...modes
    }
    const before = structuredClone(props)
    expect(validateInteractiveProps('SELECT', props)).toEqual([])
    expect(props).toEqual(before)
    const serialized = JSON.stringify(props)
    const restored: unknown = JSON.parse(serialized)
    expect(validateInteractiveProps('SELECT', restored)).toEqual([])
    expect(restored).toEqual(before)
  })

  test.each(['showSearch', 'virtual'] as const)(
    'SELECT %s accepts no callable configuration',
    (key) => {
      expect(validateInteractiveProps('SELECT', { [key]: () => true })).toMatchObject([
        {
          code: 'interactive-props-non-json-value',
          path: `interactiveProps.${key}`,
          severity: 'error'
        }
      ])
    }
  )
})
