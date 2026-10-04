import * as v from 'valibot'

import { FLUTTER_PREVIEW_SNAPSHOT_LIMITS as LIMITS } from './limits'
import { flutterPreviewNodeSchema } from './node-schema'

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(256))
const finite = v.pipe(v.number(), v.finite())
const color = v.strictObject({ r: finite, g: finite, b: finite, a: finite })
const variable = v.looseObject({
  id,
  name: v.string(),
  type: v.picklist(['COLOR', 'FLOAT', 'STRING', 'BOOLEAN']),
  collectionId: id,
  valuesByMode: v.record(
    id,
    v.union([color, finite, v.string(), v.boolean(), v.strictObject({ aliasId: id })])
  ),
  description: v.string(),
  hiddenFromPublishing: v.boolean()
})
const collection = v.strictObject({
  id,
  name: v.string(),
  modes: v.pipe(
    v.array(v.strictObject({ modeId: id, name: v.string() })),
    v.minLength(1),
    v.maxLength(256)
  ),
  defaultModeId: id,
  variableIds: v.pipe(v.array(id), v.maxLength(LIMITS.maxVariables))
})
const graph = v.strictObject({
  rootId: id,
  nodes: v.pipe(
    v.array(v.tuple([id, flutterPreviewNodeSchema])),
    v.minLength(1),
    v.maxLength(LIMITS.maxNodes)
  ),
  images: v.pipe(v.array(v.tuple([id, v.string()])), v.maxLength(LIMITS.maxImages)),
  variables: v.pipe(v.array(v.tuple([id, variable])), v.maxLength(LIMITS.maxVariables)),
  variableCollections: v.pipe(
    v.array(v.tuple([id, collection])),
    v.maxLength(LIMITS.maxCollections)
  ),
  activeMode: v.pipe(v.array(v.tuple([id, id])), v.maxLength(LIMITS.maxCollections)),
  documentColorSpace: v.picklist(['srgb', 'display-p3'])
})

export const flutterPreviewSnapshotSchema = v.strictObject({
  version: v.literal(1),
  pageIds: v.pipe(v.array(id), v.minLength(1), v.maxLength(LIMITS.maxPages)),
  graph
})
