/** Browser-side runtime for authenticated server-workflow invocations. */
export function buildLowcodeServerClientRuntime(): string {
  return `import { getSupabaseClient } from './_lowcode_supabase'

export async function invokeServerWorkflow(
  workflowId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await getSupabaseClient().functions.invoke('openpencil-runtime', {
    body: { workflowId, args }
  })
  if (error) throw new Error('Server workflow invocation failed.')
  return data
}
`
}
