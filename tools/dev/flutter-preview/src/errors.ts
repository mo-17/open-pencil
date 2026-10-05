export class FlutterPreviewError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'FlutterPreviewError'
  }
}

export function boundedText(value: string, bytes = 4_096): string {
  let length = 0
  let result = ''
  for (const character of value) {
    length += Buffer.byteLength(character)
    if (length > bytes) break
    result += character
  }
  return result
}

export function aborted(): FlutterPreviewError {
  return new FlutterPreviewError(
    'flutter-preview-cancelled',
    'Flutter preview operation was cancelled.'
  )
}

export function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw aborted()
}
