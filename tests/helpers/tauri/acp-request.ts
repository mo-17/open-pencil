import * as v from 'valibot'

const messageSchema = v.looseObject({
  id: v.optional(v.number()),
  method: v.string(),
  params: v.optional(v.record(v.string(), v.unknown()), {})
})

const requestSchema = v.looseObject({ ...messageSchema.entries, id: v.number() })

export function parseACPTestMessage(line: string) {
  return v.parse(v.pipe(v.string(), v.parseJson(), messageSchema), line)
}

export function parseACPTestRequest(line: string) {
  return v.parse(v.pipe(v.string(), v.parseJson(), requestSchema), line)
}
