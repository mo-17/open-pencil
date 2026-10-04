import * as v from 'valibot'

import type {
  LowcodeApplicationEnterGuardV1,
  LowcodeApplicationLeaveConfirmV1
} from '@open-pencil/scene-graph'

import { parseExpression, type ExprAst } from '../expression'
import { validateLowcodeBackFallback } from '../routes'
import { applicationDataRecord } from './data'

export const LOWCODE_APPLICATION_GUARD_EXPRESSION_MAX_LENGTH = 2048
export const LOWCODE_APPLICATION_GUARD_FALLBACK_MAX_LENGTH = 2048
export const LOWCODE_APPLICATION_GUARD_MESSAGE_MAX_LENGTH = 1024

const unsafeMemberNames = new Set(['__proto__', 'prototype', 'constructor'])

/** Syntax and portable AST safety only; the compiler resolves the allowed state/route scope. */
export function validateLowcodeApplicationGuardExpression(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > LOWCODE_APPLICATION_GUARD_EXPRESSION_MAX_LENGTH
  )
    return false
  const parsed = parseExpression(value)
  if (!parsed.ok) return false
  const pending: ExprAst[] = [parsed.ast]
  while (pending.length) {
    const ast = pending.pop()
    if (!ast) continue
    if (ast.kind === 'ident' && unsafeMemberNames.has(ast.name)) return false
    if (ast.kind === 'member') {
      if (unsafeMemberNames.has(ast.property)) return false
      pending.push(ast.object)
    } else if (ast.kind === 'binary') pending.push(ast.left, ast.right)
    else if (ast.kind === 'unary') pending.push(ast.arg)
    else if (ast.kind === 'ternary') pending.push(ast.test, ast.consequent, ast.alternate)
    else if (ast.kind === 'template') return false
  }
  return true
}

export function validateLowcodeApplicationGuardFallback(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= LOWCODE_APPLICATION_GUARD_FALLBACK_MAX_LENGTH &&
    value.trim() === value &&
    validateLowcodeBackFallback(value).ok
  )
}

export function validateLowcodeApplicationGuardMessage(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= LOWCODE_APPLICATION_GUARD_MESSAGE_MAX_LENGTH
  )
}

export const applicationEnterGuardSchema = v.strictObject({
  conditionExpr: v.custom<string>(validateLowcodeApplicationGuardExpression),
  fallback: v.custom<string>(validateLowcodeApplicationGuardFallback)
})
export const applicationLeaveConfirmSchema = v.strictObject({
  dirtyExpr: v.custom<string>(validateLowcodeApplicationGuardExpression),
  message: v.custom<string>(validateLowcodeApplicationGuardMessage)
})

export type LowcodeApplicationEnterGuardValidation =
  | { ok: true; value: LowcodeApplicationEnterGuardV1 }
  | { ok: false; reason: string }
export type LowcodeApplicationLeaveConfirmValidation =
  | { ok: true; value: LowcodeApplicationLeaveConfirmV1 }
  | { ok: false; reason: string }

export function validateLowcodeApplicationEnterGuard(
  value: unknown
): LowcodeApplicationEnterGuardValidation {
  const parsed = v.safeParse(applicationEnterGuardSchema, applicationDataRecord(value))
  return parsed.success
    ? { ok: true, value: parsed.output }
    : {
        ok: false,
        reason: 'Expected a safe condition expression and a concrete internal fallback.'
      }
}

export function validateLowcodeApplicationLeaveConfirm(
  value: unknown
): LowcodeApplicationLeaveConfirmValidation {
  const parsed = v.safeParse(applicationLeaveConfirmSchema, applicationDataRecord(value))
  return parsed.success
    ? { ok: true, value: parsed.output }
    : { ok: false, reason: 'Expected a safe dirty expression and a bounded confirmation message.' }
}
