import { expect, test } from 'bun:test'

import { classifyTestTypeDiagnostics } from '../src/diagnostics'

test('a source syntax failure cannot report that test types passed', () => {
  const output =
    'packages/compiler/src/dev-server.ts(3,1): error TS18026: A hashbang must be the first line.\npackages/compiler/src/dev-server.ts(3,2): error TS1005: Expected semicolon.'
  expect(classifyTestTypeDiagnostics(output, 2)).toEqual({
    failures: [],
    blocked: output.split('\n')
  })
})

test('compiler configuration and abnormal exits fail closed', () => {
  expect(classifyTestTypeDiagnostics('error TS18003: No inputs found.', 2).blocked).toHaveLength(1)
  expect(classifyTestTypeDiagnostics('compiler crashed', 1).blocked).toEqual(['compiler crashed'])
  expect(classifyTestTypeDiagnostics('', 1).blocked).toEqual(['tsgo exited with 1'])
})

test('source semantic globals are judged by their shipping compilation boundary', () => {
  expect(
    classifyTestTypeDiagnostics('src/app/fetch.ts(1,2): error TS2322: Bun fetch globals differ.', 2)
  ).toEqual({ failures: [], blocked: [] })
})

test('reports app and package test errors and accepts a clean compiler run', () => {
  const output =
    'tests/app/example.test.ts(1,2): error TS2322: Invalid fixture.\npackages/core/tests/example.test.ts(1,2): error TS2339: Invalid method.'
  expect(classifyTestTypeDiagnostics(output, 2)).toEqual({
    failures: output.split('\n'),
    blocked: []
  })
  expect(classifyTestTypeDiagnostics('', 0)).toEqual({ failures: [], blocked: [] })
})
