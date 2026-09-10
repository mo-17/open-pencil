const SENSITIVE_FIELD =
  '(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passphrase|client[_-]?secret|secret|credential|api[_-]?key|room[_-]?key|key|code|k)'

export function sanitizeDiagnosticMessage(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  const structuredSecret = new RegExp(
    `((?:["']?${SENSITIVE_FIELD}["']?)\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,}\\]]+)`,
    'gi'
  )

  return text
    .replace(
      /([?&#](?:access_token|refresh_token|id_token|token|code|key|k|secret|credential|password|client_secret)=)[^&#\s]*/gi,
      '$1[redacted]'
    )
    .replace(structuredSecret, '$1[redacted]')
    .replace(/(https?:\/\/[^\s#]+)#[^\s]*/gi, '$1#[redacted]')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [redacted]')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, '[redacted]')
    .slice(0, 4_000)
}
