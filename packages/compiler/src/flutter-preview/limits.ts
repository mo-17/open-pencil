export const FLUTTER_PREVIEW_SNAPSHOT_LIMITS = Object.freeze({
  maxSnapshotBytes: 8 * 1024 * 1024,
  maxNodes: 5000,
  maxPages: 32,
  maxImages: 256,
  maxVariables: 5000,
  maxCollections: 256,
  maxImageBytes: 2 * 1024 * 1024,
  maxTotalImageBytes: 4 * 1024 * 1024,
  maxBinaryBytes: 128 * 1024,
  maxDepth: 64,
  maxStringBytes: 256 * 1024,
  maxArrayLength: 128 * 1024,
  maxRecordKeys: 4096,
  maxValues: 500_000
})

export function invalidFlutterPreviewSnapshot(): never {
  throw new TypeError('Invalid Flutter preview snapshot.')
}
