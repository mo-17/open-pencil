import { readFigFile } from '@open-pencil/core/io/formats/fig'

import { documentNameFromFigPath } from '@/app/document/io/names'

export class StorageFigImportError extends Error {
  constructor(readonly code: 'invalid-extension') {
    super('Select a .fig file')
    this.name = 'StorageFigImportError'
  }
}

export type PreparedStorageFigImport = Readonly<{
  name: string
  figBytes: Uint8Array
}>

/** Validate an ordinary user-selected FIG and then read a fresh, non-transferred byte snapshot. */
export async function prepareStorageFigImport(
  file: File,
  signal?: AbortSignal
): Promise<PreparedStorageFigImport> {
  if (!/\.fig$/i.test(file.name)) throw new StorageFigImportError('invalid-extension')
  await readFigFile(file, { populate: 'none', signal })
  signal?.throwIfAborted()
  const figBytes = new Uint8Array(await file.arrayBuffer())
  signal?.throwIfAborted()
  return {
    name: documentNameFromFigPath(file.name).trim() || 'Untitled',
    figBytes
  }
}
