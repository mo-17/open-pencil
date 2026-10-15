import * as v from 'valibot'

/** Compiler-owned package manifests keep unrelated fields when adding generated dependencies. */
const PackageJSONSchema = v.looseObject({
  name: v.optional(v.string()),
  dependencies: v.optional(v.record(v.string(), v.string())),
  devDependencies: v.optional(v.record(v.string(), v.string())),
  scripts: v.optional(v.record(v.string(), v.string()))
})

export function parseCompilerPackageJSON(source: string) {
  return v.parse(v.pipe(v.string(), v.parseJson(), PackageJSONSchema), source)
}
