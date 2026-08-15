import { describe, expect, test } from 'bun:test'

import {
  validateExpression as validateFromCompiler,
  validateStateName as validateStateFromCompiler,
  validateURLTemplate as validateURLFromCompiler
} from '@open-pencil/compiler'
import { parseExpression as parseFromCore } from '@open-pencil/core/lowcode-validation'
import { auditApplicationRuntime as auditFromCore } from '@open-pencil/core/lowcode-validation/application-runtime'
import {
  parseExpression as parseFromLowcode,
  validateExpression as validateFromLowcode,
  validateStateName as validateStateFromLowcode,
  validateURLTemplate as validateURLFromLowcode
} from '@open-pencil/lowcode'
import { auditApplicationRuntime as auditFromLowcode } from '@open-pencil/lowcode/application-runtime'

describe('@open-pencil/core lowcode compatibility exports', () => {
  test('forward the established root and application-runtime APIs', () => {
    expect(parseFromCore).toBe(parseFromLowcode)
    expect(auditFromCore).toBe(auditFromLowcode)
    expect(validateFromCompiler).toBe(validateFromLowcode)
    expect(validateStateFromCompiler).toBe(validateStateFromLowcode)
    expect(validateURLFromCompiler).toBe(validateURLFromLowcode)
  })
})
