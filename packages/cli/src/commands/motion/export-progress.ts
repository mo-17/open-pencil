import type { MotionExportProgress } from '@open-pencil/core/io/motion-export'

import { dim } from '#cli/format'

/**
 * Keep interactive progress truthful without printing one line per rendered frame.
 * Each phase reports its first value, ten-percent boundaries, and completion.
 */
export function createMotionExportProgressReporter(
  write: (message: string) => void
): (progress: MotionExportProgress) => void {
  let previous = ''
  return (progress) => {
    const percentage =
      progress.total > 0
        ? Math.min(100, Math.floor((progress.completed / progress.total) * 100))
        : 0
    const bucket = progress.completed >= progress.total ? 100 : Math.floor(percentage / 10) * 10
    const key = `${progress.phase}:${bucket}`
    if (key === previous) return
    previous = key
    write(
      dim(
        `Motion export ${progress.phase}: ${progress.completed}/${progress.total} (${percentage}%)`
      )
    )
  }
}
