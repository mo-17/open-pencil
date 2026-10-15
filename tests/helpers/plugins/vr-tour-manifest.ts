import * as v from 'valibot'

// The archive envelope is decoded here; negative tests may then alter config
// before the production artifact reviewer checks its complete semantic contract.
const vrTourArchiveManifestSchema = v.looseObject({
  version: v.number(),
  target: v.string(),
  tours: v.array(
    v.looseObject({
      sourceId: v.string(),
      key: v.string(),
      config: v.record(v.string(), v.unknown())
    })
  ),
  assets: v.array(
    v.looseObject({
      url: v.string(),
      mime: v.string(),
      sha256: v.string(),
      byteLength: v.number(),
      chunks: v.array(v.string())
    })
  )
})
export function parseVRTourArchiveManifest(source: string) {
  return v.parse(v.pipe(v.string(), v.parseJson(), vrTourArchiveManifestSchema), source)
}
