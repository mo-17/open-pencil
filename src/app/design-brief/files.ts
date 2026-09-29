import { saveExportedFile } from '@/app/document/export/files'
import { downloadBlob } from '@/app/document/io/browser'

export async function saveDesignBrief(markdown: string): Promise<boolean> {
  return saveExportedFile(
    new TextEncoder().encode(markdown),
    'openpencil-design-brief.md',
    'Markdown',
    '.md',
    'text/markdown',
    downloadBlob,
    { browserPickerFailure: 'throw' }
  )
}
