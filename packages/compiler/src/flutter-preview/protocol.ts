import * as v from 'valibot'

import { validateFlutterPreviewSnapshot } from './snapshot'
import type { FlutterPreviewSnapshot } from './snapshot'

export const FLUTTER_PREVIEW_MAX_COMMAND_BYTES = 16 * 1024 * 1024
export const FLUTTER_PREVIEW_MAX_EVENT_BYTES = 64 * 1024

const text = (maximum: number) => v.pipe(v.string(), v.minLength(1), v.maxLength(maximum))
const id = v.pipe(v.string(), v.uuid())
const revision = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const deviceSchema = v.strictObject({
  id: text(256),
  name: text(256),
  platform: v.picklist(['ios', 'android'])
})
const stateSchema = v.strictObject({
  sessionId: v.nullable(id),
  phase: v.picklist(['idle', 'preparing', 'running', 'reloading', 'stopping', 'failed']),
  deviceId: v.nullable(text(256)),
  revision: v.nullable(revision),
  projectDirectory: v.nullable(text(4096))
})
const common = { version: v.literal(1), type: v.literal('command'), id }
const commandSchema = v.variant('command', [
  v.strictObject({ ...common, command: v.literal('devices') }),
  v.strictObject({
    ...common,
    command: v.literal('start'),
    deviceId: text(256),
    revision,
    snapshot: v.unknown()
  }),
  v.strictObject({ ...common, command: v.literal('update'), revision, snapshot: v.unknown() }),
  v.strictObject({ ...common, command: v.literal('stop') }),
  v.strictObject({ ...common, command: v.literal('close') })
])
const eventCommon = { version: v.literal(1), id: v.nullable(id) }
const warningSchema = v.strictObject({
  code: text(256),
  message: text(1024),
  nodeId: v.optional(text(256))
})
const eventSchema = v.variant('type', [
  v.strictObject({ version: v.literal(1), type: v.literal('ready'), id: v.null() }),
  v.strictObject({
    ...eventCommon,
    type: v.literal('result'),
    state: stateSchema,
    devices: v.optional(v.pipe(v.array(deviceSchema), v.maxLength(64))),
    warnings: v.optional(v.pipe(v.array(warningSchema), v.maxLength(32)))
  }),
  v.strictObject({
    ...eventCommon,
    type: v.literal('error'),
    code: text(128),
    message: text(8192),
    state: stateSchema
  }),
  v.strictObject({
    ...eventCommon,
    type: v.literal('progress'),
    phase: v.optional(text(64)),
    message: text(8192)
  }),
  v.strictObject({ ...eventCommon, type: v.literal('log'), message: text(8192) })
])

export type FlutterPreviewDevice = v.InferOutput<typeof deviceSchema>
export type FlutterPreviewState = v.InferOutput<typeof stateSchema>
export type FlutterPreviewEvent = v.InferOutput<typeof eventSchema>
type RawCommand = v.InferOutput<typeof commandSchema>
export type FlutterPreviewCommand =
  | Exclude<RawCommand, { command: 'start' | 'update' }>
  | (Extract<RawCommand, { command: 'start' | 'update' }> & { snapshot: FlutterPreviewSnapshot })

export function parseFlutterPreviewCommand(input: unknown): FlutterPreviewCommand {
  const result = v.safeParse(commandSchema, input)
  if (!result.success) throw new TypeError('Invalid Flutter preview command.')
  const command = result.output
  if (command.command === 'start' || command.command === 'update') {
    return { ...command, snapshot: validateFlutterPreviewSnapshot(command.snapshot) }
  }
  return command
}

export function parseFlutterPreviewEvent(input: unknown): FlutterPreviewEvent {
  const result = v.safeParse(eventSchema, input)
  if (!result.success) throw new TypeError('Invalid Flutter preview event.')
  return result.output
}
