import type { CodePenSidecarDiagnostic } from './protocol'
import type { CodePenRoutingStatus } from './routing'

const SERVER_ARTIFACT_FILES = new Set([
  '.env.server.example',
  'openpencil-server.manifest.json',
  'SERVER_DEPLOYMENT.md'
])

export function isCodePenServerArtifact(path: string): boolean {
  return path.startsWith('supabase/') || SERVER_ARTIFACT_FILES.has(path)
}

export function projectPolicyDiagnostics(input: {
  bundleJavaScript: string
  routingStatus: CodePenRoutingStatus
  serverArtifactsOmitted: boolean
}): CodePenSidecarDiagnostic[] {
  const diagnostics: CodePenSidecarDiagnostic[] = []
  if (input.routingStatus === 'changed') {
    diagnostics.push({
      code: 'codepen-router-hash-fallback',
      severity: 'warning',
      message:
        'CodePen uses an embedded preview path, so browser-history routing was changed to hash routing for this showcase only.'
    })
  } else if (input.routingStatus === 'unavailable') {
    diagnostics.push({
      code: 'codepen-router-hash-fallback-unavailable',
      severity: 'warning',
      message:
        'A custom browser-history router could not be safely rewritten; CodePen navigation may require manual adjustment.'
    })
  }
  if (input.serverArtifactsOmitted) {
    diagnostics.push({
      code: 'codepen-server-artifacts-omitted',
      severity: 'warning',
      message:
        'Server workflow artifacts are not supported by CodePen Prefill and were omitted from the showcase bundle.'
    })
  }
  if (
    /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource|WebTransport|Worker|SharedWorker|importScripts|RTCPeerConnection)\b|\.sendBeacon\b|\bgtag\s*\(|\bserviceWorker\s*\.\s*register\b|\b(?:https?|wss?):\/\//.test(
      input.bundleJavaScript
    )
  ) {
    diagnostics.push({
      code: 'codepen-client-network-runtime',
      severity: 'warning',
      message:
        'This showcase contains client-side network or analytics behavior; CodePen does not host its remote services or server workflows.'
    })
  }
  return diagnostics
}
