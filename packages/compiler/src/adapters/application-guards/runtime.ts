import type { IRTree } from '#compiler/ir/types'

import { applicationGuardDialogSource } from './dialog'
import { applicationGuardPolicies } from './emit'

export function applicationGuardsRuntimeSource(pages: readonly IRTree[]): string {
  return `export type GuardScope = Record<string, unknown>
type Expression = { kind: string; value?: unknown; name?: string; property?: string; object?: Expression; arg?: Expression; op?: string; left?: Expression; right?: Expression; test?: Expression; consequent?: Expression; alternate?: Expression }
export type GuardPolicy = { pageId: string; route: string; enter?: { ast: Expression; references: string[]; fallback: string }; leave?: { ast: Expression; references: string[]; message: string }; auth?: { fallback: string; ready: boolean } }
export const policies: GuardPolicy[] = ${JSON.stringify(applicationGuardPolicies(pages))}
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
function property(value: unknown, name: string): unknown {
  if (typeof value === 'string' && name === 'length') return value.length
  if (forbidden.has(name) || !value || typeof value !== 'object') throw new Error('Unavailable guard value')
  if (Array.isArray(value) && name === 'length') return value.length
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Array.isArray(value)) throw new Error('Unavailable guard value')
  const field = Object.getOwnPropertyDescriptor(value, name)
  if (!field) return undefined
  if (!('value' in field)) throw new Error('Unavailable guard value')
  return field.value
}
function scalar(value: unknown): string | number | boolean | null | undefined {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error('Unavailable guard scalar')
}
function arithmetic(op: string, left: unknown, right: unknown): unknown {
  const a = scalar(left), b = scalar(right)
  if (op === '==') return a == b
  if (op === '!=') return a != b
  if (op === '+') return typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : Number(a) + Number(b)
  const x = Number(a), y = Number(b)
  if (op === '-') return x - y
  if (op === '*') return x * y
  if (op === '/') return x / y
  if (op === '%') return x % y
  if (typeof a === 'string' && typeof b === 'string') {
    if (op === '<') return a < b
    if (op === '>') return a > b
    if (op === '<=') return a <= b
    if (op === '>=') return a >= b
  }
  if (op === '<') return x < y
  if (op === '>') return x > y
  if (op === '<=') return x <= y
  if (op === '>=') return x >= y
  throw new Error('Unavailable guard operation')
}
export function evaluateGuard(ast: Expression, scope: GuardScope): unknown {
  let budget = 512
  const evaluate = (node: Expression | undefined): unknown => {
    if (!node || --budget < 0) throw new Error('Unavailable guard expression')
    if (node.kind === 'number' || node.kind === 'string') return node.value
    if (node.kind === 'ident') {
      if (node.name === 'true') return true
      if (node.name === 'false') return false
      if (node.name === 'null') return null
      if (node.name === 'undefined') return undefined
      return property(scope, node.name ?? '')
    }
    if (node.kind === 'member') return property(evaluate(node.object), node.property ?? '')
    if (node.kind === 'unary') {
      const value = evaluate(node.arg)
      if (node.op === '!') return !value
      return node.op === '-' ? -Number(scalar(value)) : Number(scalar(value))
    }
    if (node.kind === 'ternary') return evaluate(evaluate(node.test) ? node.consequent : node.alternate)
    if (node.kind === 'binary') {
      const left = evaluate(node.left)
      if (node.op === '&&') return left && evaluate(node.right)
      if (node.op === '||') return left || evaluate(node.right)
      const right = evaluate(node.right)
      if (node.op === '===') return left === right
      if (node.op === '!==') return left !== right
      return arithmetic(node.op ?? '', left, right)
    }
    throw new Error('Unavailable guard expression')
  }
  return evaluate(ast)
}
export function guardBoolean(ast: Expression, scope: GuardScope): boolean | undefined {
  try { const value = evaluateGuard(ast, scope); return typeof value === 'boolean' ? value : undefined } catch { return undefined }
}
export function routeScope(href: string, params: Record<string, unknown> = {}): GuardScope {
  const url = new URL(href, 'https://openpencil.invalid')
  const query = Object.fromEntries(url.searchParams)
  return { $params: params, $query: query, $route: { path: url.pathname, pathname: url.pathname, search: url.search, hash: url.hash, fullPath: url.pathname + url.search + url.hash, params, query } }
}
type Leave = { pageId: string; owner: string; scope: () => GuardScope; active: () => boolean }
let currentLeave: Leave | undefined
let revision = 0
const inputListeners = new Set<() => void>()
export function notifyGuardInputs(): void { revision++; for (const listener of inputListeners) listener() }
export function guardRevision(): number { return revision }
export function guardPreviewBootPending(): boolean { return typeof window !== 'undefined' && window.__opApplicationGuardBootPending === true }
export function releaseGuardPreviewBoot(): void { if (guardPreviewBootPending()) { window.__opApplicationGuardBootPending = false; notifyGuardInputs() } }
export function subscribeGuardInputs(listener: () => void): () => void { inputListeners.add(listener); return () => { inputListeners.delete(listener) } }
export function registerLeave(pageId: string, owner: string, scope: () => GuardScope, active: () => boolean): () => void {
  const value = { pageId, owner, scope, active }
  currentLeave = value
  return () => { if (currentLeave === value) { currentLeave = undefined; dismissLeaveConfirmation() } }
}
export function leaveRequirement(from: string, to: string): { owner: Leave; message: string } | undefined {
  if (from.split('#')[0] === to.split('#')[0]) return undefined
  const owner = currentLeave
  const policy = owner && policies.find((page) => page.pageId === owner.pageId)?.leave
  if (!owner || !policy || !owner.active() || owner.owner !== from.split('#')[0]) return undefined
  if (guardBoolean(policy.ast, owner.scope()) === false) return undefined
  return { owner, message: policy.message }
}
export async function allowLeave(from: string, to: string, signal?: AbortSignal): Promise<boolean> {
  const requirement = leaveRequirement(from, to)
  if (!requirement) return !signal?.aborted
  const accepted = await new Promise<boolean>((resolve) => {
    let settled = false, unsubscribe = () => {}
    const finish = (value: boolean, dismiss = false) => { if (settled) return; settled = true; unsubscribe(); resolve(value); if (dismiss) dismissLeaveConfirmation() }
    unsubscribe = subscribeGuardInputs(() => {
      if (currentLeave !== requirement.owner || !requirement.owner.active()) finish(false, true)
      else if (!leaveRequirement(from, to)) finish(true, true)
    })
    void confirmLeave(requirement.message, signal).then((value) => finish(value))
  })
  if (signal?.aborted || currentLeave !== requirement.owner || !requirement.owner.active()) return false
  if (!leaveRequirement(from, to)) return true
  return accepted
}
export function entryOutcome(policy: GuardPolicy, scope: GuardScope): { allowed: boolean; waiting?: boolean; fallback?: string } {
  if (policy.auth) {
    const user = scope.$currentUser
    const authField = (name: string) => { try { return property(user, name) } catch { return undefined } }
    const ready = policy.auth.ready ? authField('ready') === true : true
    if (!ready) return { allowed: false, waiting: true }
    if (authField('signedIn') !== true) return { allowed: false, fallback: policy.auth.fallback }
  }
  if (policy.enter && guardBoolean(policy.enter.ast, scope) !== true) return { allowed: false, fallback: policy.enter.fallback }
  return { allowed: true }
}
export function installUnloadGuard(current: () => string): () => void {
  if (typeof window === 'undefined') return () => {}
  const onUnload = (event: BeforeUnloadEvent) => {
    if (!leaveRequirement(current(), '__document_exit__')) return
    event.preventDefault(); event.returnValue = ''
  }
  window.addEventListener('beforeunload', onUnload)
  return () => { window.removeEventListener('beforeunload', onUnload); dismissLeaveConfirmation() }
}
declare global {
  interface OpenPencilApplicationNavigationGuard { requestRoute(route: string, replace?: boolean): Promise<boolean>; cancelPending?(): void }
  interface Window { __opApplicationNavigationGuard?: OpenPencilApplicationNavigationGuard; __opApplicationGuardBootPending?: boolean }
}
${applicationGuardDialogSource()}`
}
