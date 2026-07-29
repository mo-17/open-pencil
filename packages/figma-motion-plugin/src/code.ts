import { runFigmaMotionAdapter } from './run'

function resultMessage(summary: ReturnType<typeof runFigmaMotionAdapter>): string {
  if (summary.selectionCount === 0) return 'Select one or more nodes exported by OpenPencil'
  const { applied, unchanged, conflict, unsupported, failed, skipped } = summary.counts
  const successful = applied + unchanged
  const blocked = conflict + unsupported + failed
  return `OpenPencil Motion: ${successful} ready, ${blocked} blocked, ${skipped} skipped`
}

function main(): void {
  try {
    const summary = runFigmaMotionAdapter(figma)
    console.debug('[OpenPencil Motion Adapter]', summary)
    figma.closePlugin(resultMessage(summary))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[OpenPencil Motion Adapter]', { status: 'failed', message })
    figma.closePlugin(`OpenPencil Motion failed: ${message}`)
  }
}

main()
