/** Shared bounded local-file behavior embedded into both reviewed runtimes. */
export const UPLOAD_LOCAL_FILES_RUNTIME = `
interface SelectedLocalFile {
  id: number
  file: File
}

const EMPTY_LOCAL_FILES: SelectedLocalFile[] = []

interface DropFiles {
  files: File[]
  ignoredItems: number
  rejectedDirectory: boolean
  rejectedNonFile: boolean
}

interface LocalSelectionConfig {
  accept: readonly string[]
  multiple: boolean
  maxFiles: number
  maxFileBytes: number
}

const MAX_INCOMING_FILES = 100
const MAX_ERROR_MESSAGES = 4
const MAX_DISPLAY_NAME_CODE_POINTS = 157

function fileNameTail(value: string): string {
  const boundedTail = value.slice(Math.max(0, value.length - 512))
  const separator = Math.max(boundedTail.lastIndexOf('/'), boundedTail.lastIndexOf('\\\\'))
  return boundedTail.slice(separator + 1) || 'Unnamed file'
}

function displayFileName(value: string): string {
  let result = ''
  let length = 0
  for (const character of fileNameTail(value)) {
    if (length >= MAX_DISPLAY_NAME_CODE_POINTS) return result + '...'
    const point = character.codePointAt(0) ?? 0
    const unsafe =
      point < 32 ||
      (point >= 127 && point <= 159) ||
      point === 0x061c ||
      point === 0x200e ||
      point === 0x200f ||
      (point >= 0x2028 && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069)
    result += unsafe ? '�' : character
    length += 1
  }
  return result
}

function formatBytes(value: number): string {
  if (value < 1024) return value + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0) + ' KB'
  return (value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0) + ' MB'
}

function matchesAccept(file: File, accept: readonly string[]): boolean {
  if (accept.length === 0) return true
  const name = fileNameTail(file.name)
  const mime = file.type.length <= 127 ? file.type.trim().toLowerCase() : ''
  return accept.some((rawToken) => {
    const token = rawToken.trim().toLowerCase()
    if (token.startsWith('.')) return name.slice(-token.length).toLowerCase() === token
    if (token.endsWith('/*')) return mime !== '' && mime.startsWith(token.slice(0, -1))
    return mime !== '' && mime === token
  })
}

function filesFromDrop(dataTransfer: DataTransfer): DropFiles {
  const result: DropFiles = {
    files: [],
    ignoredItems: 0,
    rejectedDirectory: false,
    rejectedNonFile: false
  }
  if (dataTransfer.items.length === 0) {
    const count = Math.min(dataTransfer.files.length, MAX_INCOMING_FILES)
    for (let index = 0; index < count; index += 1) {
      const file = dataTransfer.files[index]
      if (file) result.files.push(file)
    }
    result.ignoredItems = Math.max(0, dataTransfer.files.length - count)
    return result
  }
  const count = Math.min(dataTransfer.items.length, MAX_INCOMING_FILES)
  result.ignoredItems = Math.max(0, dataTransfer.items.length - count)
  for (let index = 0; index < count; index += 1) {
    const item = dataTransfer.items[index]
    if (!item) continue
    if (item.kind !== 'file') {
      result.rejectedNonFile = true
      continue
    }
    const candidate = item as DataTransferItem & {
      webkitGetAsEntry?: () => { isDirectory: boolean; isFile: boolean } | null
    }
    const entry = candidate.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      result.rejectedDirectory = true
      continue
    }
    const file = item.getAsFile()
    if (!file || (entry && !entry.isFile)) {
      result.rejectedNonFile = true
      continue
    }
    result.files.push(file)
  }
  return result
}

/** Metadata identifies a repeated local selection, not a content hash. */
function sameLocalFile(left: File, right: File): boolean {
  return left.name === right.name && left.size === right.size && left.type === right.type && left.lastModified === right.lastModified
}

function selectLocalFiles(
  current: readonly SelectedLocalFile[],
  files: ArrayLike<File>,
  config: LocalSelectionConfig,
  createId: () => number,
  dropMessages: readonly string[] = [],
  additionalUnchecked = 0
): { selected: SelectedLocalFile[]; error: string } {
    const accepted: File[] = []
    const messages = dropMessages.slice(0, MAX_ERROR_MESSAGES)
    let suppressedRejections = Math.max(0, dropMessages.length - messages.length)
    const addRejection = (message: string) => {
      if (messages.length < MAX_ERROR_MESSAGES) messages.push(message)
      else suppressedRejections += 1
    }
    const candidateCount = Math.min(files.length, MAX_INCOMING_FILES)
    for (let index = 0; index < candidateCount; index += 1) {
      const file = files[index]
      if (!file) continue
      const name = displayFileName(file.name)
      if (!matchesAccept(file, config.accept)) {
        addRejection('“' + name + '” is not an accepted file type.')
      } else if (file.size > config.maxFileBytes) {
        addRejection(
          '“' + name + '” exceeds the ' + formatBytes(config.maxFileBytes) + ' limit.'
        )
      } else if (current.some((entry) => sameLocalFile(entry.file, file)) || accepted.some((entry) => sameLocalFile(entry, file))) {
        addRejection('“' + name + '” is already selected.')
      } else {
        accepted.push(file)
      }
    }
    const summaries: string[] = []
    let next = [...current]
    if (!config.multiple) {
      if (accepted.length > 1) summaries.push('Choose one file at a time.')
      const first = accepted[0]
      if (first) next = [{ id: createId(), file: first }]
    } else {
      const available = Math.max(0, config.maxFiles - current.length)
      if (accepted.length > available) {
        summaries.push('You can select up to ' + config.maxFiles + ' files.')
      }
      next = [
        ...current,
        ...accepted.slice(0, available).map((file) => ({
          id: createId(),
          file
        }))
      ]
    }
    if (suppressedRejections > 0) {
      summaries.push(suppressedRejections + ' more files were rejected.')
    }
    const unchecked = Math.max(0, files.length - candidateCount) + additionalUnchecked
    if (unchecked > 0) summaries.push(unchecked + ' additional files were not checked.')
    return { selected: next, error: [...messages, ...summaries].join(' ') }
}

/** External files remain browser-local objects. Invalid projections never notify
 * the owner or fall back to local state; no file content is read here. */
function projectLocalFiles(
  value: unknown,
  config: LocalSelectionConfig,
  current: readonly SelectedLocalFile[],
  createId: () => number
): SelectedLocalFile[] | null {
  try {
    if (!Array.isArray(value) || value.length > Math.min(MAX_INCOMING_FILES, config.maxFiles) || (!config.multiple && value.length > 1)) return null
    if (Reflect.ownKeys(value).length !== value.length + 1) return null
    const result: SelectedLocalFile[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
      const file: unknown = descriptor.value
      if (!(file instanceof File) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > config.maxFileBytes || (file.webkitRelativePath !== undefined && file.webkitRelativePath !== '') || !matchesAccept(file, config.accept)) return null
      if (result.some((entry) => sameLocalFile(entry.file, file))) return null
      result.push(current.find((entry) => entry.file === file) ?? { id: createId(), file })
    }
    return result
  } catch {
    return null
  }
}
`
