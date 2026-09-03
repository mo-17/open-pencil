/** Browser-side client for authenticated generated server-workflow calls. */
export function buildVueServerClientRuntime(): string {
  return `import { getSupabaseClient } from './lowcode-supabase'

export async function invokeServerWorkflow(
  workflowId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const client = getSupabaseClient()
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  const token = sessionData.session?.access_token
  if (sessionError || !token) throw new Error('Server workflow requires an authenticated user.')
  const { data, error } = await client.functions.invoke('openpencil-runtime', {
    body: { workflowId, args },
    headers: { Authorization: \`Bearer \${token}\` }
  })
  if (error) throw new Error('Server workflow invocation failed.')
  return data
}
`
}
