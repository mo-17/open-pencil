/**
 * Rewrite document-root theme selectors so emitted CSS works when the host
 * injects it into an app-owned ShadowRoot. Standalone output never calls this
 * helper and therefore remains byte-identical.
 */
export function scopeMicrofrontendCSS(source: string): string {
  return source
    .replace(
      /:root\[data-theme="([^"]+)"\],\s*\.([\w-]+)\s*\{/g,
      ':host([data-theme="$1"]), :host(.$2), .$2 {'
    )
    .replace(/:root\s*\{/g, ':host {')
    .replace(/^(\s*)\.(dark|theme-[\w-]+)\s*\{/gm, '$1:host(.$2), .$2 {')
    .replace(/^(\s*)body\s*\{/gm, '$1:host {')
}
