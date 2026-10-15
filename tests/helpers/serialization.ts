import * as v from 'valibot'

/** Read the byte-vector wire format emitted by local FIG fixtures. */
export function parseJSONBytes(source: string): number[] {
  return v.parse(
    v.pipe(
      v.string(),
      v.parseJson(),
      v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255)))
    ),
    source
  )
}
