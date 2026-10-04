import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { parseFlutterPreviewEvent } from '@open-pencil/compiler/flutter-preview'

import { BoundedEventWriter, runFlutterPreviewProtocol } from '../src/protocol'
import { controllerFixture, deferred, InputQueue, startCommand, tick } from './helpers/index'

test('ready and correlated JSONL results are clean; close preempts an active start', async () => {
  const source = new InputQueue()
  const lines: string[] = []
  const writer = new BoundedEventWriter(async (line) => {
    lines.push(line)
  })
  const fixture = controllerFixture({ hangingCreate: true })
  const protocol = runFlutterPreviewProtocol(source, writer, () => fixture.controller)
  source.push(`${JSON.stringify(startCommand())}\n`)
  await tick()
  const closeId = randomUUID()
  source.push(`${JSON.stringify({ version: 1, type: 'command', id: closeId, command: 'close' })}\n`)
  await protocol
  const events = lines.map((line) => parseFlutterPreviewEvent(JSON.parse(line)))
  expect(events[0]).toEqual({ version: 1, type: 'ready', id: null })
  expect(events.find((event) => event.id === closeId)).toMatchObject({
    type: 'result',
    state: { phase: 'idle' }
  })
  expect(
    events.some((event) => event.type === 'error' && event.code === 'flutter-preview-cancelled')
  ).toBe(true)
  expect(fixture.calls.at(-1)?.child.stops).toBeGreaterThan(0)
})

test('invalid commands never execute or accept caller Dart and produce bounded errors', async () => {
  const source = new InputQueue()
  const lines: string[] = []
  const fixture = controllerFixture()
  const protocol = runFlutterPreviewProtocol(
    source,
    new BoundedEventWriter(async (line) => {
      lines.push(line)
    }),
    () => fixture.controller
  )
  source.push('bad JSON\n')
  source.push(
    `${JSON.stringify({ version: 1, type: 'command', id: randomUUID(), command: 'start', files: { 'lib/main.dart': 'caller Dart' } })}\n`
  )
  source.end()
  await protocol
  expect(fixture.calls).toHaveLength(0)
  expect(
    lines
      .map((line) => parseFlutterPreviewEvent(JSON.parse(line)))
      .filter((event) => event.type === 'error')
  ).toHaveLength(2)
  expect(lines.join('')).not.toContain('caller Dart')
})

test('blocked stdout has a hard queued byte cap', async () => {
  const blocked = deferred<undefined>()
  const writer = new BoundedEventWriter(() => blocked.promise, 128)
  writer.send({ version: 1, type: 'ready', id: null })
  expect(() =>
    writer.send({ version: 1, type: 'log', id: null, message: 'x'.repeat(128) })
  ).toThrow('byte budget')
  blocked.resolve(undefined)
  await writer.flush()
})
