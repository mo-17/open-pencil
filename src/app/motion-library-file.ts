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
  maxJSONBytes: number
): void {
  if (!Number.isFinite(size) || size < 0 || size > maxJSONBytes) {
    throw new Error(`${motionLibraryLabel(kind)} files may not exceed ${maxJSONBytes} bytes.`)
  }
}

export async function readBrowserMotionLibraryFile(
  file: File,
  kind: MotionLibraryKind,
  maxJSONBytes: number
): Promise<string> {
  assertMotionLibraryFileSize(file.size, kind, maxJSONBytes)
  return file.text()
}

export async function chooseTauriMotionLibraryFile(
  kind: MotionLibraryKind,
  maxJSONBytes: number
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
  assertMotionLibraryFileSize((await stat(path)).size, kind, maxJSONBytes)
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
