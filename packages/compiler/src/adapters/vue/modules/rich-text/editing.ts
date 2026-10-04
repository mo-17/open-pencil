/** Plain-text paste/drop and reviewed formatting commands; all markup uses safe DOM construction. */
export const RICH_TEXT_VUE_EDITING_RUNTIME = `
function captureSelection(): void {
  const current = window.getSelection()
  if (!current?.rangeCount || !editor.value) return
  const range = current.getRangeAt(0)
  if (editor.value.contains(range.commonAncestorContainer)) selection = range.cloneRange()
}

function editSelection(action: () => void): void {
  if (readOnly.value || !editor.value) return
  editor.value.focus({ preventScroll: true })
  const current = window.getSelection()
  if (selection && current) {
    current.removeAllRanges()
    current.addRange(selection)
  }
  try { action() } finally { captureSelection(); syncDocument() }
}

function runCommand(command: string, value?: string): void {
  editSelection(() => {
    document.execCommand('styleWithCSS', false, 'false')
    document.execCommand(command, false, value)
  })
}

function applyLink(): void {
  if (readOnly.value) return
  const requested = window.prompt('Enter a safe URL (https, mailto, tel, /, #, or ?):')
  if (requested === null) return
  const href = safeHref(requested)
  if (href) runCommand('createLink', href)
  else status.value = 'Link rejected: unsupported or unsafe URL'
}

function toggleInlineCode(): void {
  editSelection(() => {
    const current = window.getSelection()
    if (!current?.rangeCount || !editor.value) return
    const range = current.getRangeAt(0)
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const existing = start?.closest('code')
    if (existing && editor.value.contains(existing) && existing.parentElement?.tagName !== 'PRE') {
      existing.replaceWith(...Array.from(existing.childNodes))
      editor.value.normalize()
      return
    }
    const code = document.createElement('code')
    if (range.collapsed) {
      range.insertNode(code)
      range.setStart(code, 0)
      range.collapse(true)
    } else {
      try { range.surroundContents(code) } catch { code.append(range.extractContents()); range.insertNode(code) }
      range.selectNodeContents(code)
    }
    current.removeAllRanges()
    current.addRange(range)
  })
}

function insertPlainText(text: string): void {
  editSelection(() => {
    if (!editor.value) return
    const bounded = text.slice(0, Math.max(0, LIMITS.totalText - (editor.value.textContent?.length ?? 0)))
    if (bounded.length !== text.length) status.value = 'Content limit reached'
    if (document.execCommand('insertText', false, bounded)) return
    const current = window.getSelection()
    if (!current?.rangeCount) return
    const range = current.getRangeAt(0)
    range.deleteContents()
    const node = document.createTextNode(bounded)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    current.removeAllRanges()
    current.addRange(range)
  })
}

function handlePaste(event: ClipboardEvent): void {
  event.preventDefault()
  insertPlainText(event.clipboardData?.getData('text/plain') ?? '')
}

function handleDrop(event: DragEvent): void {
  event.preventDefault()
  insertPlainText(event.dataTransfer?.getData('text/plain') ?? '')
}

function preventLinkNavigation(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('a')) event.preventDefault()
}

function blockStyle(event: Event): void {
  if (!(event.currentTarget instanceof HTMLSelectElement)) return
  if (event.currentTarget.value) runCommand('formatBlock', event.currentTarget.value)
  event.currentTarget.value = ''
}

function focusEditor(): void {
  try { document.execCommand('defaultParagraphSeparator', false, 'p') } catch { /* Browser fallback. */ }
}

function blurEditor(): void { captureSelection(); syncDocument() }
`
