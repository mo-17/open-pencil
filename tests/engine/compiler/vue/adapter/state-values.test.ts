import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createContext } from '#compiler/adapters/vue/shared'
import { emitVueStateAssignment } from '#compiler/adapters/vue/state-values'
import type { IRStateDecl } from '#compiler/ir/types'

import { parseExpression } from '@open-pencil/lowcode'

interface StateFixture {
  type: IRStateDecl['type']
  initial: unknown
  accepted: unknown
  rejected: unknown
}

const fixtures: StateFixture[] = [
  { type: 'string', initial: '', accepted: 'Customer title', rejected: 5 },
  { type: 'number', initial: 0, accepted: 12, rejected: '12' },
  { type: 'boolean', initial: false, accepted: true, rejected: 'true' },
  { type: 'array', initial: [], accepted: ['task'], rejected: { task: true } },
  { type: 'object', initial: {}, accepted: { active: true }, rejected: ['task'] }
]

test.each(fixtures)(
  'generated $type assignment narrows an unknown record field before mutation',
  async ({ type, initial, accepted, rejected }) => {
    const state: IRStateDecl = {
      id: 'destination',
      name: 'destination',
      type,
      defaultValue: initial
    }
    const context = createContext(false, false, new Set(), [state])
    const parsed = parseExpression('record.value')
    if (!parsed.ok) throw new Error('Invalid fixture expression')
    const assignment = emitVueStateAssignment(
      'destination',
      'record.value',
      parsed.ast,
      type,
      context,
      new Map()
    )
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-vue-state-value-'))
    try {
      const path = join(directory, 'assignment.ts')
      await writeFile(
        path,
        `const destination = { value: ${JSON.stringify(initial)} };
export function read() { return destination.value }
export function update(record: Record<string, unknown>) { ${assignment} }
`
      )
      const runtime = (await import(pathToFileURL(path).href)) as {
        read(): unknown
        update(record: Record<string, unknown>): void
      }
      runtime.update({ value: accepted })
      expect(runtime.read()).toEqual(accepted)
      expect(() => runtime.update({ value: rejected })).toThrow(
        'State value does not match its declared type.'
      )
      expect(runtime.read()).toEqual(accepted)
      expect(() => runtime.update({ value: null })).toThrow(
        'State value does not match its declared type.'
      )
      expect(runtime.read()).toEqual(accepted)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)

test('functional fallback narrows its resulting value while an already typed state copy keeps the ordinary assignment', () => {
  const states: IRStateDecl[] = [
    { id: 'title', name: 'title', type: 'string', defaultValue: '' },
    { id: 'items', name: 'items', type: 'array', defaultValue: [] }
  ]
  const context = createContext(false, false, new Set(), states)
  const functional = parseExpression('prev || record.title')
  const known = parseExpression('items')
  if (!functional.ok || !known.ok) throw new Error('Invalid fixture expression')
  expect(
    emitVueStateAssignment(
      'title',
      '__opPrevious || record.title',
      functional.ast,
      'string',
      context,
      new Map([['prev', '__opPrevious']]),
      true
    )
  ).toContain("typeof __opNextState === 'string'")
  expect(emitVueStateAssignment('items', 'items', known.ast, 'array', context, new Map())).toBe(
    'items.value = items'
  )
})

test('a scoped value shadowing a typed state is still checked at the assignment boundary', () => {
  const states: IRStateDecl[] = [{ id: 'items', name: 'items', type: 'array', defaultValue: [] }]
  const context = createContext(
    false,
    false,
    new Set(['__items']),
    states,
    new Map([['items', '__items']])
  )
  const parsed = parseExpression('items')
  if (!parsed.ok) throw new Error('Invalid fixture expression')
  expect(
    emitVueStateAssignment(
      '__items',
      '__row',
      parsed.ast,
      'array',
      context,
      new Map([['items', '__row']])
    )
  ).toContain('Array.isArray(__opNextState)')
})
