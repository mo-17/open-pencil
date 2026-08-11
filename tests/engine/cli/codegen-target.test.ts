import { describe, expect, test } from 'bun:test'

import {
  resolveCodegenTarget,
  routerForCodegenTarget,
  validateCodegenTargetFeatures
} from '#cli/codegen-target'
import buildCommand from '#cli/commands/build'
import compileCommand from '#cli/commands/compile'
import deployCommand from '#cli/commands/deploy'

describe('CLI web codegen target', () => {
  test('defaults to React and accepts an explicit case-insensitive Vue target', () => {
    expect(resolveCodegenTarget({})).toBe('react')
    expect(resolveCodegenTarget({ target: 'react' })).toBe('react')
    expect(resolveCodegenTarget({ target: 'Vue' })).toBe('vue')
    expect(() => resolveCodegenTarget({ target: 'svelte' })).toThrow(
      'Supported web targets: react, vue'
    )
  })

  test('selects the target router only for multi-page projects', () => {
    expect(routerForCodegenTarget('react', 1)).toBe('none')
    expect(routerForCodegenTarget('react', 2)).toBe('react-router-v6')
    expect(routerForCodegenTarget('vue', 1)).toBe('none')
    expect(routerForCodegenTarget('vue', 2)).toBe('vue-router-v4')
  })

  test('fails closed for Vue v1 React-only i18n and UI-kit flags', () => {
    expect(() => validateCodegenTargetFeatures({ target: 'vue', i18n: true })).toThrow(
      'Vue v1 does not support --i18n'
    )
    expect(() =>
      validateCodegenTargetFeatures({ target: 'vue', i18n: false, uiKit: 'shadcn' })
    ).toThrow('does not support the React UI kit')
    expect(() =>
      validateCodegenTargetFeatures({ target: 'react', i18n: true, uiKit: 'shadcn' })
    ).not.toThrow()
  })

  test('exposes the same target flag on source, static build, and deploy commands', () => {
    expect(compileCommand.args?.target).toBeDefined()
    expect(buildCommand.args?.target).toBeDefined()
    expect(deployCommand.args?.target).toBeDefined()
  })
})
