import { test } from 'bun:test'

import { verifyImmediateDisconnect } from './dispose/helpers'

test(
  'native local preview disconnect kills before a pending update ACK completes',
  verifyImmediateDisconnect
)
