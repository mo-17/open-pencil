import * as v from 'valibot'

const compilerFilesSchema = v.array(v.tuple([v.string(), v.string()]))

const compilerBrowserOutputSchema = v.looseObject({
  files: compilerFilesSchema,
  warnings: v.array(
    v.looseObject({
      code: v.string(),
      message: v.string(),
      nodeId: v.optional(v.string()),
      pageId: v.optional(v.string())
    })
  )
})

/** Decode the string-source projection emitted by compiler browser fixtures. */
export function parseCompilerBrowserOutput(source: string) {
  return v.parse(v.pipe(v.string(), v.parseJson(), compilerBrowserOutputSchema), source)
}

export function parseCompilerFiles(source: string) {
  return v.parse(v.pipe(v.string(), v.parseJson(), compilerFilesSchema), source)
}

export function parseCompilerFigOutput(source: string) {
  return v.parse(
    v.pipe(
      v.string(),
      v.parseJson(),
      v.looseObject({
        source: v.object({
          roots: v.array(v.object({ id: v.string(), name: v.string(), type: v.string() })),
          fields: v.array(
            v.object({
              id: v.string(),
              rootId: v.string(),
              name: v.string(),
              type: v.picklist(['INPUT', 'TEXTAREA']),
              fontSize: v.number(),
              lineHeight: v.nullable(v.number()),
              height: v.number(),
              padding: v.tuple([v.number(), v.number(), v.number(), v.number()])
            })
          )
        }),
        files: compilerFilesSchema,
        sha256: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
        byteLength: v.pipe(v.number(), v.integer(), v.minValue(0))
      })
    ),
    source
  )
}

export function parseStarterBrowserOutput(source: string) {
  return v.parse(
    v.pipe(
      v.string(),
      v.parseJson(),
      v.looseObject({
        files: compilerFilesSchema,
        paths: v.record(v.string(), v.string()),
        apiBasePath: v.string()
      })
    ),
    source
  )
}
