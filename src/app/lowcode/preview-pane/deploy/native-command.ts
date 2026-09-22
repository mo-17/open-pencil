import type { PreviewNativeChild, PreviewNativeCommand } from '../host/native-command'

interface DeployNativeOutput {
  on(event: 'data', listener: (data: string) => void): void
  off(event: 'data', listener: (data: string) => void): void
}

export interface DeployNativeCommand extends PreviewNativeCommand {
  readonly stdout: DeployNativeOutput
  readonly stderr: DeployNativeOutput
  off(event: 'close', listener: (data: { code: number | null }) => void): void
  off(event: 'error', listener: (error: string) => void): void
  spawn(): Promise<PreviewNativeChild>
}

export type CreateDeployNativeCommand = (
  program: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> }
) => DeployNativeCommand | Promise<DeployNativeCommand>

export const createDeployNativeCommand: CreateDeployNativeCommand = async (
  program,
  args,
  options
) => {
  const { Command } = await import('@tauri-apps/plugin-shell')
  return Command.create(program, args, options)
}
