/** Minimal native process contract shared by reviewed preview companions. */
export interface PreviewNativeChild {
  write(data: string): Promise<void>
  kill(): Promise<void>
}

interface PreviewNativeOutput {
  on(event: 'data', listener: (data: string) => void): void
}

export interface PreviewNativeCommand {
  readonly stdout: PreviewNativeOutput
  readonly stderr: PreviewNativeOutput
  on(event: 'close', listener: (data: { code: number | null }) => void): void
  on(event: 'error', listener: (error: string) => void): void
  spawn(): Promise<PreviewNativeChild>
}

export type CreatePreviewNativeCommand = (
  program: string,
  args: string[],
  options: { cwd: string }
) => PreviewNativeCommand | Promise<PreviewNativeCommand>

export const createPreviewNativeCommand: CreatePreviewNativeCommand = async (
  program,
  args,
  options
) => {
  const { Command } = await import('@tauri-apps/plugin-shell')
  return Command.create(program, args, options)
}
