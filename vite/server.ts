import type { ServerOptions } from 'vite'

export const WATCH_IGNORED = [
  '**/desktop/**',
  '**/packages/cli/**',
  '**/packages/mcp/**',
  '**/packages/docs/**',
  // Lowcode preview sidecar's private scan-root. The sidecar rewrites
  // tsconfig.json here on every start; without this ignore the main Vite
  // watcher reloads the app, which remounts the preview pane, which
  // respawns the sidecar — an endless restart loop.
  '**/packages/compiler/.preview-root/**',
  '**/tests/**',
  '**/.worktrees/**',
  '**/.github/**',
  '**/.pi/**',
  // Design documents are user data, never Vite modules (loaded at runtime via
  // fetch / Tauri fs). Saving one (Cmd+S) into the watched project tree would
  // otherwise trip the main watcher and full-reload the app — same restart
  // class as the .preview-root loop above.
  '**/*.fig',
  '**/*.pen'
]

export function createDevServerOptions(host: string | undefined): ServerOptions {
  return {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421
        }
      : undefined,
    watch: {
      ignored: WATCH_IGNORED
    }
  }
}
