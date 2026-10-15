import * as v from 'valibot'
export interface RecordedRequest {
  readonly url: string
  readonly init: RequestInit
  readonly maximum: number
  readonly timeout: number
}

export interface QueryBody {
  readonly query: string
  readonly parameters: readonly unknown[]
}

export function parseQueryBody(text: string): QueryBody {
  return v.parse(
    v.pipe(
      v.string(),
      v.parseJson(),
      v.strictObject({ query: v.string(), parameters: v.array(v.unknown()) })
    ),
    text
  )
}

export function parseDatabaseApplyBody(text: string) {
  return v.parse(
    v.pipe(
      v.string(),
      v.parseJson(),
      v.strictObject({ query: v.string(), read_only: v.boolean() })
    ),
    text
  )
}

export function parseMigrationBody(text: string) {
  return v.parse(
    v.pipe(v.string(), v.parseJson(), v.strictObject({ query: v.string(), name: v.string() })),
    text
  )
}
