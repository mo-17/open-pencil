import { saveExportedFile } from '@/app/document/export/files'
import { downloadBlob } from '@/app/document/io/browser'
import { isTauri } from '@/app/tauri/env'

export type MotionLibraryKind = 'preset' | 'recipe'

function motionLibraryLabel(kind: MotionLibraryKind): string {
  return `Motion ${kind} library`
}

function assertMotionLibraryFileSize(
  size: number,
  kind: MotionLibraryKind,
  maxJsonBytes: number
): void {
  if (!Number.isFinite(size) || size < 0 || size > maxJsonBytes) {
    throw new Error(`${motionLibraryLabel(kind)} files may not exceed ${maxJsonBytes} bytes.`)
  }
}

export async function readBrowserMotionLibraryFile(
  file: File,
  kind: MotionLibraryKind,
  maxJsonBytes: number
): Promise<string> {
  assertMotionLibraryFileSize(file.size, kind, maxJsonBytes)
  return file.text()
}

export async function chooseTauriMotionLibraryFile(
  kind: MotionLibraryKind,
  maxJsonBytes: number
): Promise<string | null> {
  if (!isTauri()) return null
  const [{ open }, { readTextFile, stat }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs')
  ])
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: motionLibraryLabel(kind), extensions: ['json'] }]
  })
  if (typeof path !== 'string') return null
  assertMotionLibraryFileSize((await stat(path)).size, kind, maxJsonBytes)
  return readTextFile(path)
}

export async function saveMotionLibraryFile(
  json: string,
  fileName: string,
  kind: MotionLibraryKind
): Promise<void> {
  const label = motionLibraryLabel(kind)
  await saveExportedFile(
    new TextEncoder().encode(json),
    fileName,
    label,
    '.json',
    'application/json',
    downloadBlob
  )
}
