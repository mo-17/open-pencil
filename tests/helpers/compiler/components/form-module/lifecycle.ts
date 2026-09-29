type PreviewStepResult = { ok: true } | { ok: false; error: unknown }

async function attemptPreviewStep(step: () => Promise<void>): Promise<PreviewStepResult> {
  try {
    await step()
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

/** Cleanup always runs; the earliest failure keeps its original identity. */
export async function withModuleFormCleanup(
  run: () => Promise<void>,
  leavePage: () => Promise<void>,
  closeServer: () => Promise<void>
): Promise<void> {
  const results = [
    await attemptPreviewStep(run),
    await attemptPreviewStep(leavePage),
    await attemptPreviewStep(closeServer)
  ]
  for (const result of results) {
    if (!result.ok) throw result.error
  }
}
