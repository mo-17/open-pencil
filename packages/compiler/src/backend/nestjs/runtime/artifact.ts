import type { BackendArtifactSource } from '#compiler/backend/contracts'

export function runtimeArtifact(name: string, content: string): BackendArtifactSource {
  return {
    path: `backend/nestjs/src/${name}`,
    kind: 'server-runtime',
    mediaType: 'text/typescript; charset=utf-8',
    content
  }
}
