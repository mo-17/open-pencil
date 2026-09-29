/** Snapshot the live target before an async permission or library read. */
export function captureAssetTarget(
  read: () => { graph: object; pageId: string; parentId: string | null; sourceIdentity: unknown }
) {
  const target = read()
  return () => {
    const current = read()
    return (
      current.graph === target.graph &&
      current.pageId === target.pageId &&
      current.parentId === target.parentId &&
      current.sourceIdentity === target.sourceIdentity
    )
  }
}
