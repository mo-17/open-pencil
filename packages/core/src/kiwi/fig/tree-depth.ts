export function assertParentChainDepth(
  nodeIds: Iterable<string>,
  parentIdFor: (nodeId: string) => string | undefined,
  maximum: number | undefined,
  cycleMessage: string
): void {
  if (maximum === undefined) return
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new RangeError('maxTreeDepth must be a positive safe integer')
  }

  const resolvedDepths = new Map<string, number>()
  for (const nodeId of nodeIds) {
    if (resolvedDepths.has(nodeId)) continue
    const chain: string[] = []
    const visiting = new Set<string>()
    let currentId = nodeId
    while (!resolvedDepths.has(currentId)) {
      if (visiting.has(currentId)) throw new RangeError(cycleMessage)
      visiting.add(currentId)
      chain.push(currentId)
      const parentId = parentIdFor(currentId)
      if (parentId === undefined) break
      currentId = parentId
    }

    let depth = resolvedDepths.get(currentId) ?? -1
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      depth += 1
      if (depth > maximum) {
        throw new RangeError(`.fig graph exceeds the ${maximum} level depth limit`)
      }
      resolvedDepths.set(chain[index], depth)
    }
  }
}
