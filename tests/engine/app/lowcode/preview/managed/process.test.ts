import { test } from 'bun:test'

import { verifyManagedProcessLifetime } from './process/helpers'

test(
  'managed protocol cancellation and invalid events close the owned API before forced cleanup',
  verifyManagedProcessLifetime
)
