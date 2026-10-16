import { bold, fmtList } from '#cli/format'

export function printBackendReport(
  title: string,
  report: Record<string, unknown>,
  json: boolean,
  header: () => string
): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log('')
  console.log(bold(`  ${title}`))
  console.log('')
  console.log(fmtList([{ header: header(), details: report }]))
  console.log('')
}
