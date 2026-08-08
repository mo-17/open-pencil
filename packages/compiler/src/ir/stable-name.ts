const UTF8_ENCODER = new TextEncoder()

/** Short deterministic suffix for bounded generated identifiers and paths. */
export function stableNameSuffix(value: string): string {
  let fingerprint = 2_166_136_261
  for (const byte of UTF8_ENCODER.encode(value)) {
    fingerprint = Math.imul(fingerprint ^ byte, 16_777_619)
  }
  return (fingerprint >>> 0).toString(36)
}
