import { describe, expect, test } from 'bun:test'

import { vueAdapter } from '#compiler/adapters/vue'
import type { IRElement, IRTree } from '#compiler/ir/types'

import { withDefaults } from '@open-pencil/compiler'

function vueOptions() {
  return withDefaults({
    packageName: 'vue-form-demo',
    target: 'vue',
    router: 'none',
    devMode: false
  })
}

function minimalIr(overrides: Partial<IRTree> = {}): IRTree {
  return {
    pageId: 'page',
    pageName: 'Page',
    usesRouteParams: false,
    children: [],
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: [],
    ...overrides
  }
}

function element(overrides: Partial<IRElement> = {}): IRElement {
  return {
    kind: 'element',
    sourceId: 'element',
    tag: 'div',
    className: '',
    attrs: {},
    children: [],
    ...overrides
  }
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function expectValidSfc(source: string): void {
  expect(source).toStartWith('<script setup lang="ts">')
  expect(source).toContain('</script>\n\n<template>')
  expect(source).toEndWith('</template>\n')
}

describe('Vue compiler form fail-closed behavior', () => {
  test('prevents native form submission when every authored submit action is unsupported', () => {
    const output = vueAdapter.emit(
      [
        minimalIr({
          states: [{ id: 'count', name: 'count', type: 'number', defaultValue: 0 }],
          children: [
            element({
              sourceId: 'unsupported-form',
              tag: 'form',
              events: {
                onSubmit: [
                  {
                    kind: 'supabaseMutation',
                    operation: 'insert',
                    table: 'contacts',
                    filters: []
                  }
                ]
              }
            }),
            element({
              sourceId: 'validation-form',
              tag: 'form',
              formValidationKeys: ['field'],
              events: {
                onSubmit: [
                  {
                    kind: 'setState',
                    stateName: 'count',
                    ast: { kind: 'number', value: 1 },
                    references: [],
                    mode: 'absolute'
                  }
                ]
              }
            })
          ]
        })
      ],
      vueOptions()
    )
    const page = textFile(output.files, 'src/pages/index.vue')

    expect(page).toContain('<form @submit.prevent>')
    expect(page.match(/<form @submit\.prevent>/g)).toHaveLength(1)
    expect(page).toMatch(/<form @submit\.prevent="__op_validation_form_submit_[0-9]+\(\$event\)">/)
    expect(page).toContain('if (!__validateFields(["field"])) return')
    expect(page).toContain('__opState_count_')
    expect(output.warnings.map((warning) => warning.code)).toContain('vue-supabase-unsupported')
    expect(output.warnings.map((warning) => warning.code)).not.toContain(
      'vue-validation-unsupported'
    )
    expectValidSfc(page)
  })
})
