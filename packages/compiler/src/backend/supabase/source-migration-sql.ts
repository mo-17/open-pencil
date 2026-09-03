interface TransactionSQLParts {
  readonly preamble: readonly string[]
  readonly body: readonly string[]
}

function invalid(message: string): never {
  throw new TypeError(`Supabase source migration bundle is invalid: ${message}.`)
}

/**
 * Both trusted renderers intentionally remain independently usable and therefore emit their own
 * transaction. Source migration packaging is the composition boundary: accept only their strict
 * one-transaction shape, remove those wrappers, then place every statement in one outer commit.
 */
function unwrapSingleTransactionSQL(value: string, label: string): TransactionSQLParts {
  if (!value.endsWith('\n') || value.includes('\r') || value.includes('\0')) {
    return invalid(`${label} SQL is not canonical LF-terminated text`)
  }
  const lines = value.slice(0, -1).split('\n')
  const beginIndexes = lines.flatMap((line, index) => (line === 'BEGIN;' ? [index] : []))
  const commitIndexes = lines.flatMap((line, index) => (line === 'COMMIT;' ? [index] : []))
  if (beginIndexes.length !== 1 || commitIndexes.length !== 1) {
    return invalid(`${label} SQL must have exactly one outer BEGIN/COMMIT wrapper`)
  }
  const beginIndex = beginIndexes[0]
  const commitIndex = commitIndexes[0]
  if (beginIndex >= commitIndex || commitIndex !== lines.length - 1) {
    return invalid(`${label} SQL must have exactly one outer BEGIN/COMMIT wrapper`)
  }
  const preamble = lines.slice(0, beginIndex)
  if (
    preamble.length === 0 ||
    preamble.some((line) => line.length > 0 && !line.startsWith('-- '))
  ) {
    return invalid(`${label} SQL has an unexpected transaction preamble`)
  }
  const body = lines.slice(beginIndex + 1, commitIndex)
  if (
    body.length === 0 ||
    body.some((line) => {
      const statement = line.trim().toUpperCase()
      return (
        statement === 'BEGIN;' ||
        statement === 'COMMIT;' ||
        statement === 'ROLLBACK;' ||
        statement.startsWith('START TRANSACTION')
      )
    })
  ) {
    return invalid(`${label} SQL contains nested transaction control`)
  }
  return { preamble, body }
}

/** Compose exact trusted review and Storage artifacts into one PostgreSQL atomic transaction. */
export function composeAtomicSupabaseSourceMigrationSQL(
  reviewSQL: string,
  storagePolicySQL: string | null
): string {
  const review = unwrapSingleTransactionSQL(reviewSQL, 'review')
  if (storagePolicySQL === null) return reviewSQL
  const storage = unwrapSingleTransactionSQL(storagePolicySQL, 'Storage policy')
  return [
    ...review.preamble,
    ...storage.preamble,
    'BEGIN;',
    ...review.body,
    ...storage.body,
    'COMMIT;',
    ''
  ].join('\n')
}
