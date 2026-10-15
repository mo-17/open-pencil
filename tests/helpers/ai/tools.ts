import type { ToolExecutionOptions } from 'ai'

/** Execute a dynamically discovered tool through its checked runtime callable boundary. */
export async function executeAITool(
  tool: unknown,
  input: Record<string, unknown>,
  options: Omit<ToolExecutionOptions<unknown>, 'context'> &
    Partial<Pick<ToolExecutionOptions<unknown>, 'context'>>
): Promise<unknown> {
  if (!tool || typeof tool !== 'object') throw new Error('Expected an AI tool')
  const execute = Reflect.get(tool, 'execute')
  if (typeof execute !== 'function') throw new Error('Expected an executable AI tool')
  return await execute.call(tool, input, { context: undefined, ...options })
}
