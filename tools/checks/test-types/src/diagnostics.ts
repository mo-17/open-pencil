/** Diagnostics that prevent a typed test program from being checked. */
const FILE_DIAGNOSTIC = /^(?<file>\S[^(]*)\(\d+,\d+\): error TS(?<code>\d+):/
const TEST_FILE = /^(tests|packages\/[^/]+\/tests)\//

export function classifyTestTypeDiagnostics(output: string, exitCode: number) {
  const failures: string[] = []
  const blocked: string[] = []
  const lines = output.split('\n')
  for (const line of lines) {
    if (!line.includes('error TS')) continue
    const diagnostic = FILE_DIAGNOSTIC.exec(line)?.groups
    const code = Number(diagnostic?.code)
    // TS1xxx are syntax diagnostics. TS18026 rejects a misplaced hashbang before
    // semantic checking, and carries a file path rather than a config diagnostic.
    if (!diagnostic || (code >= 1000 && code < 2000) || code === 18026) blocked.push(line)
    else if (TEST_FILE.test(diagnostic.file)) failures.push(line)
  }
  if (exitCode !== 0 && !lines.some((line) => line.includes('error TS'))) {
    blocked.push(output.trim() || `tsgo exited with ${exitCode}`)
  }
  return { failures, blocked }
}
