import { parseFigFile } from '@open-pencil/core/io/formats/fig'

/** Reopen downloaded bytes in an independent graph; the active document is untouched. */
export async function readMarketplaceProjection(data: number[]) {
  const graph = await parseFigFile(Uint8Array.from(data).buffer, { populate: 'all' })
  return [...graph.getAllNodes()].map(({ type, width, height, text }) => ({
    type,
    width,
    height,
    text
  }))
}
