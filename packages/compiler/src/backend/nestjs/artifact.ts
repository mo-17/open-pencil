import type { BackendArtifactSource } from '../contracts'

export function nestJSArtifact(
  path: string,
  content: string,
  kind: BackendArtifactSource['kind'] = 'server-runtime',
  mediaType = 'text/plain'
): BackendArtifactSource {
  return { path: 'backend/nestjs/' + path, content, kind, mediaType }
}

export function nestJSJSONArtifact(
  path: string,
  value: unknown,
  kind: BackendArtifactSource['kind']
): BackendArtifactSource {
  return nestJSArtifact(path, JSON.stringify(value, null, 2) + '\n', kind, 'application/json')
}

export function sqlIdentifier(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"'
}
