import type { EditorStore } from '@/app/editor/active-store'
import { writeTauriClipboardText } from '@/app/tauri/clipboard'
import { isTauri } from '@/app/tauri/env'

import { CLIPBOARD_COMMANDS } from './ids'

export interface ClipboardHost {
  writeText(value: string): Promise<void>
  writePNG(value: Uint8Array): Promise<void>
}

async function writeBrowserClipboardText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
}

async function writeBrowserClipboardPNG(value: Uint8Array): Promise<void> {
  if (isTauri()) {
    throw new Error('PNG clipboard export is not supported by this desktop build')
  }
  const bytes = new Uint8Array(value)
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': new Blob([bytes.buffer], { type: 'image/png' }) })
  ])
}

export const SYSTEM_CLIPBOARD_HOST: ClipboardHost = Object.freeze({
  async writeText(value: string): Promise<void> {
    if (isTauri()) await writeTauriClipboardText(value)
    else await writeBrowserClipboardText(value)
  },
  writePNG: writeBrowserClipboardPNG
})

function selectedIds(editor: EditorStore): string[] {
  const ids = [...editor.state.selectedIds]
  if (ids.length === 0) throw new Error('Select at least one layer before copying')
  return ids
}

function requiredExport(value: string | null, format: string): string {
  if (value === null) throw new Error(`The current selection cannot be exported as ${format}`)
  return value
}

export async function executeClipboardCommand(
  editor: EditorStore,
  commandId: string,
  clipboard: ClipboardHost = SYSTEM_CLIPBOARD_HOST
): Promise<string> {
  const ids = selectedIds(editor)
  if (commandId === CLIPBOARD_COMMANDS.text.commandId) {
    await clipboard.writeText(editor.copySelectionAsText(ids))
    return 'Copied selection as text'
  }
  if (commandId === CLIPBOARD_COMMANDS.svg.commandId) {
    await clipboard.writeText(requiredExport(editor.copySelectionAsSVG(ids), 'SVG'))
    return 'Copied selection as SVG'
  }
  if (commandId === CLIPBOARD_COMMANDS.jsx.commandId) {
    await clipboard.writeText(requiredExport(editor.copySelectionAsJSX(ids), 'JSX'))
    return 'Copied selection as JSX'
  }
  if (commandId === CLIPBOARD_COMMANDS.png.commandId) {
    const data = await editor.renderExportImage(ids, 2, 'PNG')
    if (!data) throw new Error('The current selection could not be rendered as PNG')
    await clipboard.writePNG(data)
    return 'Copied selection as PNG'
  }
  throw new Error(`Unsupported clipboard command: ${commandId}`)
}
